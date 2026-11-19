import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { ApplicationFailure } from '@temporalio/activity';
import * as signals from '../src/workflows/signals';
import {
  deferred,
  captured,
  fixture,
  workflowsPath,
  newRun,
  start,
  statuses,
  count,
  sleepReal,
  waitFor,
  waitPhase,
  waitParked,
  startHarness,
  stopHarness,
} from './helpers/run-workflow-harness';

beforeAll(startHarness, 240_000);

afterAll(stopHarness);

describe('RunWorkflow', () => {
  describe('ending deadline', () => {
    it('a pod that never exits is deleted and the run parks', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 2 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      const t0 = Date.now();
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      await waitPhase(h, 'parked');
      expect(Date.now() - t0).toBeGreaterThanOrEqual(2900);
      expect(count(s, 'deleteJob')).toBeGreaterThanOrEqual(1);
      // The activity hears about the cancel on its next heartbeat.
      await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      expect(s.endingDeadlines).toEqual([{ scrollbackSaved: false }]);
      expect(statuses(s)).toEqual(['starting', 'running']);
      captured['run-ending-deadline'] = h;
      await h.signal(signals.cancel);
      await h.result();
    });

    it('after Finish the deadline ends the run succeeded, not parked', async () => {
      const s = newRun({ endingDeadlineSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.executeUpdate(signals.finishRun);
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'deleteJob')).toBeGreaterThanOrEqual(1);
      expect(count(s, 'parkRun:needs_input')).toBe(0);
      expect(s.endingDeadlines).toEqual([{ scrollbackSaved: false }]);
    });

    it('a pod that exits before the deadline does not delete the Job early or record the event', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 5 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      await sleepReal(300);
      expect(count(s, 'deleteJob')).toBe(0);
      s.logs.resolve({ exitCode: 0 });
      await waitPhase(h, 'parked');
      expect(s.endingDeadlines).toEqual([]);
      expect(s.logsCancelled).toBe(false);
      // park() deletes the Job once; the deadline did not.
      expect(count(s, 'deleteJob')).toBe(1);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a pod that disappears while its Job is being deleted does not fail the run', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      s.onDeleteJob = async () => {
        // followPodLogs rejects (non-retryable) while deleteJob is still running, then deleteJob takes a while longer.
        if (count(s, 'deleteJob') === 1) {
          s.logs.reject(ApplicationFailure.nonRetryable('run pod disappeared'));
          await sleepReal(500);
        }
      };
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'parked');
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.cancel);
      expect((await h.result()).status).not.toBe('failed');
    });

    it('a failing recordEndingDeadline does not fail the run', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 1 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      s.recordEndingDeadlineFails = true;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'parked');
      expect(count(s, 'recordEndingDeadline')).toBe(1);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a cancel while the deadline event is being recorded still ends the run cancelled', async () => {
      // Nothing kept: without the cancel the run would end succeeded.
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 1 }, { endSessionExits: false });
      const recording = deferred<void>();
      s.onRecordEndingDeadline = async () => {
        recording.resolve();
        await sleepReal(3000);
      };
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await recording.promise;
      await h.cancel();
      expect((await h.result()).status).toBe('cancelled');
      expect(count(s, 'parkRun:needs_input')).toBe(0);
    });

    it('other wakes during ending do not reset the deadline', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 6 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      const t0 = Date.now();
      // Two wakes, 1.2 s and 2.4 s in. The stuck follower is given up on 5 s (ABANDON_GRACE_MS) after the delete, so
      // the park lands that much after the deadline. Without a reset it lands at about 11.16 s (6 s + 5 s plus about
      // 0.16 s of overhead measured here). A reset by the first wake alone would land at about 12.4 s, by the second
      // alone at about 13.6 s. The 11.8 s ceiling therefore fails if either wake restarts the deadline, with 0.6 s of
      // slack on each side; the 10.6 s floor catches an early park.
      await sleepReal(1200);
      await h.signal(signals.terminalAttached);
      await sleepReal(1200);
      await h.signal(signals.terminalDetached);
      await waitPhase(h, 'parked');
      const took = Date.now() - t0;
      expect(took).toBeGreaterThanOrEqual(10600);
      expect(took).toBeLessThan(11800);
      expect(count(s, 'deleteJob')).toBeGreaterThanOrEqual(1);
      await h.signal(signals.cancel);
      await h.result();
    });
  });

  describe('follower reconnect (follower-reconnect)', () => {
    it('deleteJob inside park fails 5 times, then succeeds: parked, volume kept', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      s.deleteJobFailFirst = 5;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitParked(h);
      expect(count(s, 'deleteJob')).toBe(6);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await h.signal(signals.cancel);
      await h.result();
    }, 90_000);
  });

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual(['run-ending-deadline']);
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
