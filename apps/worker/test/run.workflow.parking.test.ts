import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import * as signals from '../src/workflows/signals';
import { type RunContext } from '../src/activities/run.activities';
import {
  captured,
  fixture,
  workflowsPath,
  newRun,
  start,
  statuses,
  count,
  state,
  sleepReal,
  waitPhase,
  gateForgot,
  expectFinishOnce,
  startHarness,
  stopHarness,
} from './helpers/run-workflow-harness';

beforeAll(startHarness, 240_000);

afterAll(stopHarness);

describe('RunWorkflow', () => {
  describe('parking (pause-resume)', () => {
    /** Idle (or done) run whose idle timer fires after 1 s; resolves once the workflow is parked. */
    async function parkedRun(
      kind: 'needs_input' | 'done',
      over: Partial<RunContext> = {},
      keep: number | undefined = 3600,
    ) {
      const s = newRun({ idleEndSeconds: 1, ...over });
      s.parkKeepSeconds = keep;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, kind);
      await waitPhase(h, 'parked');
      return { s, h };
    }

    it('idle: ends the session, frees the slot, parks as needs_input, posts the paused comment, keeps the volume', async () => {
      const { s, h } = await parkedRun('needs_input');
      expect(s.calls.slice(s.calls.indexOf('followPodLogs') + 1)).toEqual([
        'endSession',
        'deleteJob',
        'parkRun:needs_input',
        'postComment:paused',
      ]);
      // A finished Job must not survive the park: a resume would otherwise follow its exited pod (ensureJob keeps it).
      expect(count(s, 'ensureJobGone')).toBe(0);
      await gateForgot(s);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(count(s, 'postComment:finish')).toBe(0);
      expect(statuses(s)).toEqual(['starting', 'running']);
      expect((await state(h)).phase).toBe('parked');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('done: parks as done and posts the normal finish comment as succeeded', async () => {
      const { s, h } = await parkedRun('done');
      expect(count(s, 'parkRun:done')).toBe(1);
      expect(count(s, 'postComment:paused')).toBe(0);
      expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded' });
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect((await state(h)).phase).toBe('parked');
      await h.signal(signals.dropSession);
      expect((await h.result()).status).toBe('succeeded');
    });

    it('a parked needs_input run whose keep time passes expires: session ended, volume deleted, finish comment expired', async () => {
      // Real seconds, not 3600: other tests leave activities in flight, which stops the test server skipping time.
      const { s, h } = await parkedRun('needs_input', {}, 2);
      const out = await h.result();
      expect(out).toEqual({ status: 'expired' });
      expect(count(s, 'endKeptSession:expired')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'postComment:finish')).toBe(1);
      expect(s.comments.find((c) => c.kind === 'finish')?.details).toMatchObject({ status: 'expired' });
      expect((await state(h)).phase).toBe('done');
      captured['run-park-expire'] = h;
    });

    it('a parked done run whose keep time passes ends its session without a second comment and stays succeeded', async () => {
      const { s, h } = await parkedRun('done', {}, 2);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'endKeptSession:expired')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'postComment:finish')).toBe(1);
    });

    it('dropSession on a parked done run ends the session as dropped and deletes the volume', async () => {
      const { s, h } = await parkedRun('done');
      await h.signal(signals.dropSession);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'endKeptSession:dropped')).toBe(1);
      expect(count(s, 'endKeptSession:expired')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'postComment:finish')).toBe(1);
    });

    it('dropSession on a parked needs_input run is ignored', async () => {
      const { s, h } = await parkedRun('needs_input');
      await h.signal(signals.dropSession);
      await sleepReal(300);
      expect((await state(h)).phase).toBe('parked');
      expect(count(s, 'endKeptSession:dropped')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('finishRun on a parked needs_input run is accepted: volume deleted, succeeded with no session, finish comment', async () => {
      const { s, h } = await parkedRun('needs_input');
      expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(s.statuses.at(-1)).toMatchObject({ status: 'succeeded', session: null });
      expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded' });
      expect(count(s, 'endKeptSession:expired')).toBe(0);
    });

    it('finishRun on a parked done run is rejected with NotFinishable', async () => {
      const { h } = await parkedRun('done');
      await expect(h.executeUpdate(signals.finishRun)).rejects.toMatchObject({ cause: { type: 'NotFinishable' } });
      expect((await state(h)).phase).toBe('parked');
      await h.signal(signals.dropSession);
      await h.result();
    });

    it('cancel on a parked needs_input run ends it as cancelled and deletes the volume', async () => {
      const { s, h } = await parkedRun('needs_input');
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(s.statuses.at(-1)).toMatchObject({ status: 'cancelled', session: null });
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expectFinishOnce(s);
    });

    it('cancel on a parked done run changes nothing', async () => {
      const { s, h } = await parkedRun('done');
      await h.signal(signals.cancel);
      await sleepReal(300);
      expect((await state(h)).phase).toBe('parked');
      expect(statuses(s)).toEqual(['starting', 'running']);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.dropSession);
      await h.result();
    });

    it('nothing kept (null expiry): the volume is deleted and the run closes as succeeded without finalize', async () => {
      const { s, h } = await parkedRunOrClosed('done');
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'deleteJob')).toBe(1);
      expect(count(s, 'ensureJobGone')).toBe(0);
      expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded' });
      expect(statuses(s)).toEqual(['starting', 'running']);
    });

    async function parkedRunOrClosed(kind: 'needs_input' | 'done') {
      const s = newRun({ idleEndSeconds: 1 });
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, kind);
      return { s, h };
    }

    it('Review Focus 1: attach and working after the session end began still park; no running status after the park', async () => {
      const s = newRun({ idleEndSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      await h.signal(signals.terminalAttached);
      await h.signal(signals.agentState, 'working');
      await sleepReal(200);
      expect((await state(h)).phase).toBe('ending');
      s.logs.resolve({ exitCode: 0 });
      await waitPhase(h, 'parked');
      expect(statuses(s)).toEqual(['starting', 'running']);
      expect((await state(h)).terminalAttached).toBe(0);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a person pressing Finish on a live idle run ends it: volume deleted, succeeded, never parked', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.executeUpdate(signals.finishRun);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'parkRun:needs_input')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(s.statuses.at(-1)).toMatchObject({ status: 'succeeded', session: null });
    });
  });

  describe('follower reconnect (follower-reconnect)', () => {
    it('hard timer during an outage: finalize deleteJob fails 5 times, then succeeds: timed_out, then deleteRunVolume', async () => {
      const s = newRun({ timeoutSeconds: 1 });
      s.deleteJobFailFirst = 5;
      const h = await start(s);
      expect((await h.result()).status).toBe('timed_out');
      expect(count(s, 'deleteJob')).toBe(6);
      expect(statuses(s).at(-1)).toBe('timed_out');
      expect(s.calls.indexOf('deleteRunVolume')).toBeGreaterThan(s.calls.lastIndexOf('deleteJob'));
    }, 90_000);
  });

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual(['run-park-expire']);
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
