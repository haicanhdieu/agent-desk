import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { type WorkflowHandle } from '@temporalio/client';
import * as signals from '../src/workflows/signals';
import { type RunContext } from '../src/activities/run.activities';
import {
  type Script,
  deferred,
  captured,
  fixture,
  workflowsPath,
  newRun,
  start,
  statuses,
  count,
  state,
  sleepReal,
  waitFor,
  waitPhase,
  gateForgot,
  skipUntil,
  waitParked,
  startHarness,
  stopHarness,
} from './helpers/run-workflow-harness';

beforeAll(startHarness, 240_000);

afterAll(stopHarness);

describe('RunWorkflow', () => {
  describe('resuming (pause-resume)', () => {
    /** A run parked after 1 s idle (kept `keep` s); resolves once parked. */
    async function parked(kind: 'needs_input' | 'done', over: Partial<RunContext> = {}, keep = 3600) {
      const s = newRun({ idleEndSeconds: 1, ...over });
      s.parkKeepSeconds = keep;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, kind);
      await waitPhase(h, 'parked');
      return { s, h };
    }
    /** Presses Resume and waits until the resumed pod's Job is requested. */
    async function resume(s: Script, h: WorkflowHandle) {
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
    }
    /** A resumed run that is up and held live: a terminal is attached so the idle timer stays off. */
    async function live(kind: 'needs_input' | 'done', over: Partial<RunContext> = {}) {
      const { s, h } = await parked(kind, over);
      await resume(s, h);
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === (kind === 'done' ? 'done' : 'idle'), 'resumed status');
      await h.signal(signals.terminalAttached);
      return { s, h };
    }

    it('needs_input: queued, starting, then idle after sessionStarted; Job and logs started in resume mode', async () => {
      const { s, h } = await parked('needs_input');
      await resume(s, h);
      expect((await state(h)).phase).toBe('resuming');
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle after resume');
      expect(statuses(s)).toEqual(['starting', 'running', 'queued', 'starting', 'idle']);
      expect(s.statuses[2]).toMatchObject({ status: 'queued', reopen: true, keepAgentNote: true });
      expect(s.statuses[4]).toMatchObject({ status: 'idle', keepAgentNote: true, session: null });
      expect(count(s, 'requestSlot')).toBe(2);
      expect(s.createOpts[1]).toEqual({ resume: true, deadlineSeconds: 3600 });
      expect(s.followOpts[1]).toEqual({ resume: true });
      await h.signal(signals.terminalAttached);
      expect((await state(h)).phase).toBe('idle');
      // A repeated sessionStarted changes nothing.
      await h.signal(signals.sessionStarted);
      await sleepReal(200);
      expect(statuses(s)).toHaveLength(5);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      captured['run-park-resume'] = h;
    });

    it('a stopped run parks as stopped, resumes as Needs you, and Finish then ends it succeeded', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.sessionStarted);
      expect(await h.executeUpdate(signals.stopSession)).toEqual({ accepted: true });
      await waitPhase(h, 'parked');
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      expect(s.parkReasons).toEqual(['stopped']);
      expect(count(s, 'postComment:paused')).toBe(0);
      await resume(s, h);
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle after resume');
      expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'deleteRunVolume')).toBe(1);
      captured['run-stop-session'] = h;
    });

    it('done: the queued write re-opens and the run ends the resume in done, not idle', async () => {
      const { s, h } = await live('done');
      expect(s.statuses.find((x) => x.status === 'queued')).toMatchObject({ reopen: true, keepAgentNote: true });
      expect(statuses(s).at(-1)).toBe('done');
      expect((await state(h)).phase).toBe('agent_done');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('a resumed run left unattended parks again with a fresh keep time', async () => {
      const { s, h } = await parked('needs_input');
      await resume(s, h);
      await h.signal(signals.sessionStarted);
      await waitFor(() => count(s, 'parkRun:needs_input') === 2, 'second park');
      await waitPhase(h, 'parked');
      expect(count(s, 'endSession')).toBe(2);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('Review Focus 2: a second resume while resuming is rejected and asks for one slot only', async () => {
      const { s, h } = await parked('needs_input');
      s.jobHold = deferred();
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      await expect(h.executeUpdate(signals.resumeRun)).rejects.toMatchObject({
        cause: { type: 'NotResumable', message: 'This run is already being resumed' },
      });
      expect(count(s, 'requestSlot')).toBe(2);
      s.jobHold.resolve();
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle');
      await h.executeUpdate(signals.resumeRun).then(
        () => {
          throw new Error('a live run must not be resumable');
        },
        () => undefined,
      );
      await h.signal(signals.terminalAttached);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('Review Focus 3: the keep time runs out while the resume waits for a slot; the resume still wins', async () => {
      const projectId = randomUUID();
      const { s, h } = await parked('needs_input', { projectId, maxConcurrentRuns: 1 }, 2);
      // Another run takes the only slot, so the resume has to queue.
      const other = newRun({ projectId, maxConcurrentRuns: 1 });
      const ho = await start(other);
      await other.logsStarted.promise;
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await sleepReal(3000);
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      expect((await state(h)).phase).toBe('resuming');
      expect(count(s, 'createRunSecretAndJob')).toBe(1);
      other.logs.resolve({ exitCode: 0 });
      await ho.result();
      await waitFor(() => count(s, 'createRunSecretAndJob') === 2, 'resume Job after the slot');
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle');
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      await h.signal(signals.terminalAttached);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('Review Focus 4: exit 79 before the session started puts the run back; nothing is retried, volume kept', async () => {
      const { s, h } = await parked('needs_input');
      s.resumeResult = { exitCode: 79, resumeFailed: true };
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      await waitPhase(h, 'parked');
      expect(s.restores).toEqual([
        { kind: 'needs_input', sessionExpiresAt: s.lastExpiry, reason: 'no saved session was found' },
      ]);
      expect(count(s, 'deleteJob')).toBe(2); // the park's, and the failed resume's
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(count(s, 'createRunSecretAndJob')).toBe(2);
      expect(statuses(s)).toEqual(['starting', 'running', 'queued', 'starting']);
      await gateForgot(s);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('a missing agent credential puts the run back with a plain reason', async () => {
      const { s, h } = await parked('needs_input');
      s.resumeCreateFailure = 'NoAgentCredential';
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]?.reason).toBe('the agent or its credential is missing');
      await waitPhase(h, 'parked');
      expect(count(s, 'deleteJob')).toBe(2); // the park's, and the failed resume's
      await gateForgot(s);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a pod that exits before the session started puts the run back with a plain reason', async () => {
      const { s, h } = await parked('done');
      s.resumeResult = { exitCode: 1 };
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]).toMatchObject({ kind: 'done', reason: 'the pod could not start' });
      await waitPhase(h, 'parked');
      await h.signal(signals.dropSession);
      await h.result();
    });

    it('cancel while resuming, before the session started, cancels only the resume', async () => {
      const { s, h } = await parked('needs_input');
      s.jobHold = deferred();
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      await h.signal(signals.cancel);
      await waitFor(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]?.reason).toBe('the resume was cancelled');
      await waitPhase(h, 'parked');
      expect(statuses(s)).not.toContain('cancelled');
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await gateForgot(s);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('cancel after the session started ends the run as cancelled and deletes the volume', async () => {
      const { s, h } = await live('needs_input');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(s.statuses.at(-1)).toMatchObject({ status: 'cancelled', session: null });
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'restoreParked')).toBe(0);
    });

    it('a fallback after the original expiry has passed restores the run and then expires it at once', async () => {
      const { s, h } = await parked('needs_input', {}, 2);
      s.jobHold = deferred();
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      await sleepReal(2500);
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      await h.signal(signals.cancel);
      expect(await h.result()).toEqual({ status: 'expired' });
      expect(s.calls.indexOf('restoreParked')).toBeLessThan(s.calls.indexOf('endKeptSession:expired'));
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('time limit: the resumed pod gets the rest of the limit, never less than an hour; parked time is not counted', async () => {
      const big = await parked('needs_input', { timeoutSeconds: 7200 });
      await sleepReal(2500);
      await resume(big.s, big.h);
      const allowance = big.s.createOpts[1]?.deadlineSeconds ?? 0;
      // Used time is the first pod's ~1 s idle wait; the 2.5 s spent parked must not be in it.
      expect(allowance).toBeGreaterThanOrEqual(7197);
      expect(allowance).toBeLessThanOrEqual(7199);
      await big.h.signal(signals.sessionStarted);
      await waitFor(() => statuses(big.s).at(-1) === 'idle', 'idle');
      await big.h.signal(signals.terminalAttached);
      await big.h.signal(signals.cancel);
      await big.h.result();

      const small = await parked('needs_input', { timeoutSeconds: 100 });
      await resume(small.s, small.h);
      expect(small.s.createOpts[1]?.deadlineSeconds).toBe(3600);
      await small.h.signal(signals.sessionStarted);
      await waitFor(() => statuses(small.s).at(-1) === 'idle', 'idle');
      await small.h.signal(signals.terminalAttached);
      await small.h.signal(signals.cancel);
      await small.h.result();
    });

    it('the hard timer fires in a resumed pod: timed_out, volume deleted (succeeded when it had declared done)', async () => {
      // `resumeMinSeconds` is the test seam for the one-hour floor, so the allowance (limit 5 s, ~1 s used) is real seconds.
      const over = { timeoutSeconds: 5, resumeMinSeconds: 1 };
      const a = await live('needs_input', over);
      expect(a.s.createOpts[1]?.deadlineSeconds).toBeGreaterThanOrEqual(3);
      expect(a.s.createOpts[1]?.deadlineSeconds).toBeLessThanOrEqual(4);
      expect((await a.h.result()).status).toBe('timed_out');
      expect(count(a.s, 'deleteRunVolume')).toBe(1);
      expect(a.s.statuses.at(-1)).toMatchObject({ status: 'timed_out', session: null });

      const b = await live('done', over);
      expect((await b.h.result()).status).toBe('succeeded');
      expect(count(b.s, 'deleteRunVolume')).toBe(1);
    });
  });

  describe('follower reconnect (follower-reconnect)', () => {
    it('resume: createRunSecretAndJob and the rollback deleteJob fail retryably: back to parked with the same expiry, volume kept', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitParked(h);
      const expiry = s.lastExpiry;
      s.resumeCreateFailsRetryable = true;
      s.deleteJobFailFirst = 5;
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await skipUntil(() => count(s, 'restoreParked') === 1, 'restoreParked');
      expect(s.restores[0]?.sessionExpiresAt).toBe(expiry);
      await waitParked(h);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await gateForgot(s);
      await h.signal(signals.cancel);
      await h.result();
    }, 90_000);
  });

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual(['run-park-resume', 'run-stop-session']);
    for (const [name, h] of Object.entries(captured)) {
      const history = await h.fetchHistory();
      await Worker.runReplayHistory({ workflowsPath }, history, h.workflowId);
      if (process.env.UPDATE_REPLAY_FIXTURES === '1') {
        // Worker identities are "pid@hostname": keep machine names out of the repo.
        const json = historyToJSON(history).replace(/"identity": "[^"]*"/g, '"identity": "replay-fixture"');
        await writeFile(fixture(name), json + '\n');
      }
    }

    for (const name of Object.keys(captured)) {
      const json: unknown = JSON.parse(await readFile(fixture(name), 'utf8'));
      await Worker.runReplayHistory({ workflowsPath }, json, `fixture-${name}`);
    }
  });
});
