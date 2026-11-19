import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import * as signals from '../src/workflows/signals';
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
  waitFor,
  waitPhase,
  firstAttemptCompletedTasks,
  waitParked,
  startHarness,
  stopHarness,
} from './helpers/run-workflow-harness';

beforeAll(startHarness, 240_000);

afterAll(stopHarness);

describe('RunWorkflow', () => {
  describe('attach leases (attach-leases)', () => {
    const ID = '11111111-1111-4111-8111-111111111111';

    it('an id that stops renewing stops holding the idle timer: renewed ids hold it, then the run parks', async () => {
      // Wide margins (real time, loaded machine): the first lease would run out at 8 s; renewals at ~3, 6 and 9 s keep it
      // to ~17 s, and the state is read at ~11 s (3 s after the first expiry, 6 s before the renewed one).
      const s = newRun({ idleEndSeconds: 1, leaseTtlSeconds: 8 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.terminalAttached, ID);
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      expect((await state(h)).terminalAttached).toBe(1);
      for (let i = 0; i < 3; i++) {
        await sleepReal(3000);
        await h.signal(signals.terminalLease, [ID]);
      }
      await sleepReal(2000);
      expect((await state(h)).terminalAttached).toBe(1);
      expect(count(s, 'endSession')).toBe(0);
      // No more renewals: the lease runs out, then the idle timer parks the run.
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['idle_timeout']);
      expect((await state(h)).terminalAttached).toBe(0);
      captured['run-attach-leases'] = h;
      await h.signal(signals.cancel);
      await h.result();
    });

    it('history cost: a lease signal adds one signal event and at most one workflow task, and starts no timer', async () => {
      const s = newRun({ idleEndSeconds: 1000, leaseTtlSeconds: 600 });
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.signal(signals.terminalAttached, ID);
      // proto EventType numbers: 5 WORKFLOW_TASK_SCHEDULED, 6 STARTED, 7 COMPLETED, 8 TIMED_OUT, 9 FAILED, 17 TIMER_STARTED,
      // 18 TIMER_FIRED, 19 TIMER_CANCELED, 26 WORKFLOW_EXECUTION_SIGNALED.
      const events = async () => (await h.fetchHistory()).events ?? [];
      // Settled: the newest workflow-task event is a completed one, so no task is in flight and the count is not mid-task
      // (a task's own commands, such as a timer, are recorded after its completed event).
      const settled = async () => {
        const tasks = (await events()).map((e) => Number(e.eventType)).filter((t) => t >= 5 && t <= 9);
        return tasks[tasks.length - 1] === 7;
      };
      await waitFor(settled, 'the attach workflow task to complete');
      const before = (await events()).length;
      const SIGNALS = 5;
      for (let i = 0; i < SIGNALS; i++) {
        await h.signal(signals.terminalLease, [ID]);
        await sleepReal(300);
      }
      await waitFor(settled, 'the lease workflow tasks to complete');
      const added = (await events()).slice(before);
      const ofType = (...types: number[]) => added.filter((e) => types.includes(Number(e.eventType)));
      // Each lease signal is exactly one signal event.
      expect(ofType(26)).toHaveLength(SIGNALS);
      // A renewal must not restart the lease timer.
      expect(ofType(17, 18, 19)).toEqual([]);
      // Nothing but signals and workflow-task events (no activity, timer, child or marker).
      expect(ofType(5, 6, 7, 8, 9, 26)).toHaveLength(added.length);
      // One signal needs at most one first-attempt workflow task (a task can carry several signals). Retries are server and
      // worker noise on a loaded machine, not a cost of the signal: a failed attempt leaves no trace in the history, so its
      // retry shows up as its own scheduled, started, completed round with `attempt` above 1 and no signal before it. A
      // sticky-queue timeout leaves an orphan scheduled event that is never started plus a fresh attempt-1 task, which still
      // completes once. So first-attempt completions are at most one per signal; an extra task per signal, or any command,
      // timer or activity that needs its own task, would push this over the bound and fail the test.
      expect(firstAttemptCompletedTasks(added)).toBeLessThanOrEqual(SIGNALS);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a detach with the id releases the idle timer, and an id-less attach still counts as before', async () => {
      const s = newRun({ idleEndSeconds: 1, leaseTtlSeconds: 60 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.terminalAttached);
      await h.signal(signals.terminalAttached, ID);
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      expect((await state(h)).terminalAttached).toBe(2);
      await h.signal(signals.terminalDetached, ID);
      await h.signal(signals.terminalDetached, ID);
      await sleepReal(1800);
      expect((await state(h)).terminalAttached).toBe(1);
      expect(count(s, 'endSession')).toBe(0);
      await h.signal(signals.terminalDetached);
      await waitPhase(h, 'parked');
      await h.signal(signals.cancel);
      await h.result();
    });
  });

  describe('follower reconnect (follower-reconnect)', () => {
    it('followPodLogs throws a retryable error 5 times, then returns exit 0: succeeded (no 5-attempt cap)', async () => {
      const s = newRun();
      s.followFailFirst = 5;
      s.logs.resolve({ exitCode: 0 });
      const h = await start(s);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'followPodLogs')).toBe(6);
      expect(statuses(s)).not.toContain('failed');
    }, 90_000);

    it('idle timer fires and endSession fails 5 times, then succeeds: parks, not failed', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      s.endSessionFailFirst = 5;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitParked(h);
      expect(count(s, 'endSession')).toBe(6);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await h.signal(signals.cancel);
      await h.result();
    }, 90_000);
  });

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual(['run-attach-leases']);
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
