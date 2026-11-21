import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type WorkflowHandle } from '@temporalio/client';
import * as signals from '../src/workflows/signals';
import { type RunContext } from '../src/activities/run.activities';
import {
  type Script,
  newRun,
  start,
  statuses,
  count,
  state,
  sleepReal,
  waitFor,
  waitPhase,
  startHarness,
  stopHarness,
} from './helpers/run-workflow-harness';

beforeAll(startHarness, 240_000);

afterAll(stopHarness);

// Spec 2026-11-21 (reopened session keeps the result): once a run succeeds its result is fixed; a reopened session is a
// flag on top of Succeeded, so nothing done in it may change the result or delete the kept disk.
describe('RunWorkflow reopened session', () => {
  /** A succeeded run parked after 1 s idle with its session kept; resolves once parked. */
  async function succeededAndKept(over: Partial<RunContext> = {}, keep = 3600) {
    const s = newRun({ idleEndSeconds: 1, ...over });
    s.parkKeepSeconds = keep;
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'done');
    await waitPhase(h, 'parked');
    return { s, h };
  }
  /** Presses Reopen and waits until the reopened session is up. */
  async function reopen(s: Script, h: WorkflowHandle) {
    expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
    await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'reopen Job');
    await h.signal(signals.sessionStarted);
    await waitFor(() => statuses(s).at(-1) === 'done', 'done after reopen');
  }
  /** A reopened session held live: a terminal is attached so the idle timer stays off. */
  async function live(over: Partial<RunContext> = {}) {
    const run = await succeededAndKept(over);
    await reopen(run.s, run.h);
    await run.h.signal(signals.terminalAttached);
    return run;
  }
  /** The run is parked again as succeeded with a fresh keep time. */
  async function reparked(s: Script, h: WorkflowHandle, how: string) {
    await waitFor(() => count(s, 'parkRun:done') === 2, 'second park');
    await waitPhase(h, 'parked');
    expect(s.parkClosed[1]).toBe(how);
    expect(s.parkKeepUntils[1]).toBeUndefined();
    expect(count(s, 'parkRun:needs_input')).toBe(0);
    expect(count(s, 'deleteRunVolume')).toBe(0);
    expect(count(s, 'postComment:finish')).toBe(1);
    expect(count(s, 'postComment:paused')).toBe(0);
    expect(statuses(s)).not.toContain('cancelled');
    expect(statuses(s)).not.toContain('timed_out');
    expect(statuses(s)).not.toContain('paused');
  }

  it('marks the reopen, so the status writer can refuse any other final status', async () => {
    const { s, h } = await live();
    expect(s.statuses.find((x) => x.status === 'queued')).toMatchObject({ reopen: true, reopened: true });
    await h.signal(signals.dropSession);
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    await h.result();
  });

  it('Close session (finishRun) re-parks as succeeded with a fresh keep time and no ticket comment', async () => {
    const { s, h } = await live();
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    await reparked(s, h, 'person');
    // A second reopen works, and so does a second close.
    await reopen(s, h);
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    await waitFor(() => count(s, 'parkRun:done') === 3, 'third park');
    await waitPhase(h, 'parked');
    expect(count(s, 'deleteRunVolume')).toBe(0);
    // The re-parked run is a parked done run like any other: the per-project cap can still drop its session.
    await h.signal(signals.dropSession);
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'endKeptSession:dropped')).toBe(1);
    expect(count(s, 'deleteRunVolume')).toBe(1);
  });

  it('Cancel is ignored in a reopened session', async () => {
    const { s, h } = await live();
    await h.signal(signals.cancel);
    await sleepReal(300);
    expect((await state(h)).phase).toBe('agent_done');
    expect(statuses(s)).not.toContain('cancelled');
    expect(count(s, 'deleteRunVolume')).toBe(0);
    expect(count(s, 'postComment:finish')).toBe(1);
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    await reparked(s, h, 'person');
    await h.signal(signals.dropSession);
    expect((await h.result()).status).toBe('succeeded');
  });

  it('Stop session is refused in a reopened session', async () => {
    const { s, h } = await live();
    await expect(h.executeUpdate(signals.stopSession)).rejects.toThrow();
    expect((await state(h)).phase).toBe('agent_done');
    expect(count(s, 'parkRun:needs_input')).toBe(0);
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    await reparked(s, h, 'person');
    await h.signal(signals.dropSession);
    await h.result();
  });

  it('Close session is accepted while the agent is working', async () => {
    const { s, h } = await live();
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    await reparked(s, h, 'person');
    await h.signal(signals.dropSession);
    await h.result();
  });

  it('an idle timeout in a reopened session re-parks as succeeded, never paused', async () => {
    const { s, h } = await succeededAndKept();
    await reopen(s, h);
    // The agent works, then asks a question; nobody is attached, so the idle timer ends the session.
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await h.signal(signals.agentState, 'needs_input');
    await reparked(s, h, 'idle');
    await h.signal(signals.dropSession);
    await h.result();
  });

  it('a pod crash in a reopened session re-parks as succeeded, never paused', async () => {
    const { s, h } = await live();
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    s.resumeLogs.resolve({ exitCode: 137, agentStarted: true, podLost: true });
    await reparked(s, h, 'crash');
    await h.signal(signals.dropSession);
    await h.result();
  });

  it('the time limit in a reopened session re-parks as succeeded, never timed_out', async () => {
    const { s, h } = await live({ timeoutSeconds: 5, resumeMinSeconds: 1 });
    await reparked(s, h, 'time_limit');
    await h.signal(signals.dropSession);
    expect((await h.result()).status).toBe('succeeded');
  });

  it('Finish on a fresh live Done run keeps the disk for the normal keep time', async () => {
    const s = newRun({}, { endSessionExits: false });
    s.parkKeepSeconds = 3600;
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'done');
    await h.signal(signals.terminalAttached);
    await waitPhase(h, 'agent_done');
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    s.logs.resolve({ exitCode: 0, agentStarted: true });
    await waitFor(() => count(s, 'parkRun:done') === 1, 'park after finish');
    await waitPhase(h, 'parked');
    expect(count(s, 'deleteRunVolume')).toBe(0);
    expect(count(s, 'postComment:finish')).toBe(1);
    await h.signal(signals.dropSession);
    expect((await h.result()).status).toBe('succeeded');
  });

  it('Finish on a fresh live Done run deletes the disk when the agent keeps nothing', async () => {
    const s = newRun({}, { endSessionExits: false });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'done');
    await h.signal(signals.terminalAttached);
    await waitPhase(h, 'agent_done');
    expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
    s.logs.resolve({ exitCode: 0, agentStarted: true });
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'deleteRunVolume')).toBe(1);
    expect(count(s, 'postComment:finish')).toBe(1);
  });
});
