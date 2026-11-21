import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { Worker } from '@temporalio/worker';
import { historyToJSON } from '@temporalio/common/lib/proto-utils';
import { ApplicationFailure } from '@temporalio/activity';
import { WorkflowNotFoundError, type WorkflowHandle } from '@temporalio/client';
import { ENDING_DEADLINE_SECONDS, IDLE_END_SECONDS, QUERY, gateWorkflowId } from '@agentdesk/core';
import * as signals from '../src/workflows/signals';
import { ENDING_DEADLINE_SECONDS_DEFAULT, IDLE_END_SECONDS_DEFAULT } from '../src/workflows/run.workflow';
import { POD_PENDING_TIMEOUT } from '../src/activities/run.activities';
import {
  deferred,
  env,
  captured,
  fixture,
  TOKEN,
  workflowsPath,
  script,
  newRun,
  start,
  statuses,
  count,
  state,
  sleepReal,
  waitFor,
  waitPhase,
  gateForgot,
  expectFinishOnce,
  firstAttemptCompletedTasks,
  waitParked,
  startHarness,
  stopHarness,
} from './helpers/run-workflow-harness';

let lastSuccessHandle: WorkflowHandle | undefined;

describe('firstAttemptCompletedTasks (history-cost counter)', () => {
  let id = 0;
  type E = Parameters<typeof firstAttemptCompletedTasks>[0][number];
  const signal = (): E => ({ eventId: ++id, eventType: 26 });
  const scheduled = (attempt?: number): E => ({
    eventId: ++id,
    eventType: 5,
    workflowTaskScheduledEventAttributes: attempt === undefined ? {} : { attempt },
  });
  const started = (): E => ({ eventId: ++id, eventType: 6 });
  const completed = (of: E): E => ({
    eventId: ++id,
    eventType: 7,
    workflowTaskCompletedEventAttributes: { scheduledEventId: of.eventId },
  });
  const round = (attempt?: number): E[] => {
    const sch = scheduled(attempt);
    return [sch, started(), completed(sch)];
  };

  it('counts one per signal round, and a missing attempt counts as the first', () => {
    expect(firstAttemptCompletedTasks([signal(), ...round(1), signal(), ...round()])).toBe(2);
  });

  it('a sticky timeout (orphan scheduled, timed out, fresh attempt-1 task) still counts once', () => {
    const orphan = scheduled(1);
    const timedOut: E = { eventId: ++id, eventType: 8 };
    expect(firstAttemptCompletedTasks([signal(), orphan, timedOut, ...round(1)])).toBe(1);
  });

  it('a retried round (attempt above 1, no trace of the failed attempt) is not counted', () => {
    expect(firstAttemptCompletedTasks([signal(), ...round(1), ...round(2), ...round(3)])).toBe(1);
  });

  it('an extra first-attempt task for one signal is counted, so it can exceed the signal count', () => {
    expect(firstAttemptCompletedTasks([signal(), ...round(1), ...round(1)])).toBe(2);
  });
});

beforeAll(startHarness, 240_000);

afterAll(stopHarness);

describe('RunWorkflow', () => {
  it('ENDING_DEADLINE_SECONDS_DEFAULT mirrors core', () => {
    expect(ENDING_DEADLINE_SECONDS_DEFAULT).toBe(ENDING_DEADLINE_SECONDS);
    expect(ENDING_DEADLINE_SECONDS).toBe(90);
  });

  it('constants: idle end defaults to 30 minutes; the state query name is shared', () => {
    expect(IDLE_END_SECONDS_DEFAULT).toBe(IDLE_END_SECONDS);
    expect(IDLE_END_SECONDS).toBe(1800);
    expect(signals.runState.name).toBe(QUERY.runState);
    expect(signals.gateState.name).toBe(QUERY.gateState);
  });

  it('success: exit 0 → starting, running, succeeded; one finish comment; slot released', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 0 });
    const out = await h.result();
    expect(out).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    expect(s.statuses.at(-1)).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(s.calls).toEqual([
      'loadRun',
      'requestSlot',
      'createRunSecretAndJob',
      'postComment:start',
      'followPodLogs',
      'ensureJobGone',
      'deleteRunVolume',
      'postComment:finish',
    ]);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(count(s, 'deleteJob')).toBe(0);
    await gateForgot(s);
    expect((await state(h)).phase).toBe('done');
    lastSuccessHandle = h;
    captured['run-success'] = h;
  });

  it('idle → finish → endSession → logs complete 0 → succeeded; finish while running is ignored', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    await h.signal(signals.finish);
    await sleepReal(300);
    expect(count(s, 'endSession')).toBe(0);

    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.finish);
    const out = await h.result();
    expect(out.status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('resumed while idle writes running and stops the idle timer', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.resumed);
    await waitPhase(h, 'running');
    await sleepReal(1800);
    expect(count(s, 'endSession')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'running', 'running']);
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('idle timeout with no terminal attached → endSession → succeeded', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    const t0 = Date.now();
    await h.signal(signals.turnFinished);
    const out = await h.result();
    expect(out.status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect((s.endSessionAt ?? 0) - t0).toBeGreaterThanOrEqual(900);
    // Nothing kept: the run closes as succeeded; a person-needed run gets the paused note, not a finish comment.
    expect(count(s, 'postComment:paused')).toBe(1);
  });

  it('idle timer does not fire while a terminal is attached; fires idle-end after the last detach', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.terminalAttached);
    await h.signal(signals.terminalAttached);
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    expect((await state(h)).terminalAttached).toBe(2);
    await sleepReal(1800);
    expect(count(s, 'endSession')).toBe(0);
    await h.signal(signals.terminalDetached);
    await sleepReal(1500);
    expect(count(s, 'endSession')).toBe(0);
    const detachedAt = Date.now();
    await h.signal(signals.terminalDetached);
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect((s.endSessionAt ?? 0) - detachedAt).toBeGreaterThanOrEqual(900);
  });

  it('refreshes the workspace token on an interval while the pod runs, and stops when the run ends', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 2, 'two refreshes');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
    const after = count(s, 'refreshWorkspaceToken');
    await sleepReal(1600);
    expect(count(s, 'refreshWorkspaceToken')).toBe(after);
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    await gateForgot(s);
    captured['run-token-refresh'] = h;
  });

  it('a transient refresh failure is retried and the run is untouched', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    s.refreshFailFirst = 1;
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 2, 'a retry after the failure');
    expect((await state(h)).phase).toBe('running');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('a refresh that fails for good ends the loop but not the run', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    s.refreshFailsForGood = true;
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') === 1, 'the failing refresh');
    await sleepReal(2500);
    expect(count(s, 'refreshWorkspaceToken')).toBe(1);
    expect((await state(h)).phase).toBe('running');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('the workspace token never appears in refresh calls or history', async () => {
    const s = newRun({ tokenRefreshSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 1, 'a refresh');
    s.logs.resolve({ exitCode: 0 });
    await h.result();
    expect(JSON.stringify(await h.fetchHistory())).not.toContain(TOKEN);
  });

  it('uses the refresh delay the activities report when no override is set', async () => {
    const s = newRun();
    s.plannedRefreshSeconds = 1;
    const h = await start(s);
    await s.logsStarted.promise;
    await waitFor(() => count(s, 'refreshWorkspaceToken') >= 2, 'two refreshes at the reported delay');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('a 7 day limit is used as is: the hard timer and the log follower both take it, and the run is not cut short', async () => {
    const week = 604_800;
    const s = newRun({ timeoutSeconds: week });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    // Past the old 3300 s cap's worth of margin in every timeout: nothing was clamped.
    await sleepReal(1500);
    expect((await state(h)).phase).toBe('running');
    expect(statuses(s)).toEqual(['starting', 'running']);
    const events = (await h.fetchHistory()).events ?? [];
    const timers = events
      .map((e) => e.timerStartedEventAttributes?.startToFireTimeout?.seconds)
      .filter((x) => x != null);
    expect(timers.map(String)).toContain(String(week));
    const logsScheduled = events.find(
      (e) => e.activityTaskScheduledEventAttributes?.activityType?.name === 'followPodLogs',
    );
    expect(String(logsScheduled?.activityTaskScheduledEventAttributes?.startToCloseTimeout?.seconds)).toBe(
      String(week + 300),
    );
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('a history near the limit ends the run as failed with a plain reason, and cleanup runs', async () => {
    // 59: the startup history grew by the `reopen-keeps-result` patch marker; the limit must stay just above it.
    const s = newRun({ historyEventLimit: 59 });
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    let done = false;
    const outcome = h.result().finally(() => {
      done = true;
    });
    // Each signal adds events; the run must end on its own once the (lowered) limit is reached.
    for (let i = 0; i < 100 && !done; i++) {
      try {
        await h.signal(signals.terminalAttached);
      } catch (err) {
        // The run ended on its own between the `done` check and the signal: that is the outcome under test.
        if (!(err instanceof WorkflowNotFoundError)) throw err;
        break;
      }
      await sleepReal(20);
    }
    const out = await outcome;
    expect(out.status).toBe('failed');
    expect(out.failureReason).toContain('grew too long');
    expect(count(s, 'deleteJob')).toBe(1);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'failed' });
    expect(s.statuses.at(-1)).toMatchObject({ status: 'failed' });
    await gateForgot(s);
  });

  it('hard timeout at timeoutSeconds → deleteJob, timed_out', async () => {
    const s = newRun({ timeoutSeconds: 2 });
    const h = await start(s);
    await s.logsStarted.promise;
    const out = await h.result();
    expect(out.status).toBe('timed_out');
    expect(statuses(s)).toEqual(['starting', 'running', 'timed_out']);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'ensureJobGone')).toBe(0);
    await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
    expect(expectFinishOnce(s)).toMatchObject({ status: 'timed_out' });
    await gateForgot(s);
  });

  it('cancel while waiting for a slot → cancelled, no Job, slot released, late grant ignored', async () => {
    const s = newRun({ maxConcurrentRuns: 0 });
    const h = await start(s);
    await waitPhase(h, 'waiting_slot');
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['cancelled']);
    expect(count(s, 'createRunSecretAndJob')).toBe(0);
    expect(count(s, 'deleteJob')).toBe(0);
    expect(count(s, 'ensureJobGone')).toBe(0);
    expectFinishOnce(s);
    await gateForgot(s);
    // A slot opening up later must not grant (or start) anything for this run.
    await env.client.workflow.getHandle(gateWorkflowId(s.ctx.projectId)).signal(signals.setLimit, 1);
    await gateForgot(s);
    expect(count(s, 'createRunSecretAndJob')).toBe(0);
  });

  it('a run that finds the project gate full posts the queued comment while it waits, then starts when a slot frees', async () => {
    const projectId = randomUUID();
    const first = newRun({ projectId, maxConcurrentRuns: 1 });
    const h1 = await start(first);
    await first.logsStarted.promise;

    const second = newRun({ projectId, maxConcurrentRuns: 1 });
    const h2 = await start(second);
    await waitFor(() => count(second, 'postComment:queued') === 1, 'queued comment');
    expect((await state(h2)).phase).toBe('waiting_slot');
    expect(count(second, 'createRunSecretAndJob')).toBe(0);
    expect(count(first, 'postComment:queued')).toBe(0);

    first.logs.resolve({ exitCode: 0 });
    await h1.result();
    await second.logsStarted.promise;
    expect(second.calls.slice(0, 5)).toEqual([
      'loadRun',
      'requestSlot',
      'postComment:queued',
      'createRunSecretAndJob',
      'postComment:start',
    ]);
    second.logs.resolve({ exitCode: 0 });
    await h2.result();
  });

  it('Review Focus 2: cancel after the Job is created, before the first log line → deleteJob, cancelled, one finish comment', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    expect((await state(h)).phase).toBe('running');
    await h.signal(signals.cancel);
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['starting', 'cancelled']);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'ensureJobGone')).toBe(0);
    await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
    captured['run-cancel-starting'] = h;
    expect(expectFinishOnce(s)).toMatchObject({ status: 'cancelled' });
    await gateForgot(s);
  });

  it('cancel while createRunSecretAndJob is in flight → deleteJob, cancelled, no start comment', async () => {
    const s = newRun();
    s.jobHold = deferred();
    const h = await start(s);
    await s.jobCalled.promise;
    expect((await state(h)).phase).toBe('starting');
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['starting', 'cancelled']);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'postComment:start')).toBe(0);
    expect(count(s, 'followPodLogs')).toBe(0);
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('a result without agentStarted (the old shape) and exit code 2 → failed with exitCode 2; finish comment carries the scrollback tail', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 2, scrollbackTail: 'Error: tests failed\n' });
    const out = await h.result();
    expect(out).toMatchObject({ status: 'failed', exitCode: 2 });
    expect(s.statuses.at(-1)).toMatchObject({ status: 'failed', exitCode: 2 });
    expect(expectFinishOnce(s)).toMatchObject({
      status: 'failed',
      exitCode: 2,
      scrollbackTail: 'Error: tests failed\n',
    });
    expect(count(s, 'ensureJobGone')).toBe(1);
    await gateForgot(s);
  });

  it('failed in setup → setRunStatus carries failureStage setup; finish details carry it with no tail', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 78, failureStage: 'setup', setupExitCode: 1, scrollbackTail: 'should be dropped' });
    const out = await h.result();
    expect(out).toMatchObject({ status: 'failed', exitCode: 1, failureReason: 'setup failed (exit 1)' });
    expect(s.statuses.at(-1)).toMatchObject({
      status: 'failed',
      exitCode: 1,
      failureReason: 'setup failed (exit 1)',
      failureStage: 'setup',
    });
    const details = expectFinishOnce(s);
    expect(details).toMatchObject({ status: 'failed', failureReason: 'setup failed (exit 1)', failureStage: 'setup' });
    expect(details?.scrollbackTail).toBeUndefined();
    await gateForgot(s);
  });

  it('setup timed out → failed with reason "setup timed out" and stage setup', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    s.logs.resolve({ exitCode: 78, failureStage: 'setup' });
    await h.result();
    expect(s.statuses.at(-1)).toMatchObject({
      status: 'failed',
      failureReason: 'setup timed out',
      failureStage: 'setup',
    });
    await gateForgot(s);
  });

  it('a pre-session exit (agentStarted false) carries no stage; a result lacking the field keeps agent', async () => {
    const pre = newRun({}, { firstLine: false });
    const h1 = await start(pre);
    await pre.logsStarted.promise;
    pre.logs.resolve({ exitCode: 137, agentStarted: false });
    await h1.result();
    expect(pre.statuses.at(-1)?.failureStage).toBeUndefined();
    expect(pre.statuses.at(-1)).toMatchObject({ status: 'failed', exitCode: 137 });
    expect(expectFinishOnce(pre)?.failureStage).toBeUndefined();

    const old = newRun();
    const h2 = await start(old);
    await old.logsStarted.promise;
    old.logs.resolve({ exitCode: 137 });
    await h2.result();
    expect(old.statuses.at(-1)).toMatchObject({ failureStage: 'agent' });
  });

  it('infra failure carries no failure stage; a non-zero exit in a result without agentStarted carries agent', async () => {
    const infra = newRun({}, { firstLine: false });
    const h1 = await start(infra);
    await infra.logsStarted.promise;
    infra.logs.reject(ApplicationFailure.nonRetryable('no node', POD_PENDING_TIMEOUT));
    await h1.result();
    expect(infra.statuses.at(-1)?.failureStage).toBeUndefined();
    expect(expectFinishOnce(infra)?.failureStage).toBeUndefined();

    const agent = newRun();
    const h2 = await start(agent);
    await agent.logsStarted.promise;
    agent.logs.resolve({ exitCode: 3 });
    await h2.result();
    expect(agent.statuses.at(-1)).toMatchObject({ status: 'failed', failureStage: 'agent' });
    expect(expectFinishOnce(agent)).toMatchObject({ failureStage: 'agent' });
  });

  it('followPodLogs fails non-retryably (PodPendingTimeout) → failed with the reason, Job deleted', async () => {
    const s = newRun({}, { firstLine: false });
    const h = await start(s);
    await s.logsStarted.promise;
    const reason = '0/1 nodes are available: 1 Insufficient memory.';
    s.logs.reject(ApplicationFailure.nonRetryable(reason, POD_PENDING_TIMEOUT));
    const out = await h.result();
    expect(out).toMatchObject({ status: 'failed', failureReason: reason });
    expect(s.statuses.at(-1)).toMatchObject({ status: 'failed', failureReason: reason });
    expect(statuses(s)).toEqual(['starting', 'failed']);
    expect(count(s, 'followPodLogs')).toBe(1);
    expect(count(s, 'deleteJob')).toBe(1);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'failed', failureReason: reason });
    await gateForgot(s);
  });

  it('cancel while loadRun is in flight → cancelled, one finish comment, no Job, no slot', async () => {
    const s = newRun();
    s.loadHold = deferred();
    const h = await start(s);
    await waitFor(() => count(s, 'loadRun') === 1, 'loadRun started');
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['cancelled']);
    expect(expectFinishOnce(s)).toMatchObject({ status: 'cancelled' });
    expect(count(s, 'createRunSecretAndJob')).toBe(0);
    expect(count(s, 'requestSlot')).toBe(0);
    expect(count(s, 'deleteJob') + count(s, 'ensureJobGone')).toBe(0);
    s.loadHold.resolve();
    captured['run-cancel-loading'] = h;
  });

  it('cancel while loadRun is in flight for a run that is already final → no status write, no comment', async () => {
    const s = newRun({ status: 'succeeded' });
    s.loadHold = deferred();
    const h = await start(s);
    await waitFor(() => count(s, 'loadRun') === 1, 'loadRun started');
    await h.signal(signals.cancel);
    expect((await h.result()).status).toBe('succeeded');
    expect(s.statuses).toEqual([]);
    expect(count(s, 'postComment:finish')).toBe(0);
    s.loadHold.resolve();
  });

  it('a run that is already final does nothing', async () => {
    const s = newRun({ status: 'succeeded' });
    const h = await start(s);
    expect((await h.result()).status).toBe('succeeded');
    expect(s.calls).toEqual(['loadRun']);
    expect(s.statuses).toEqual([]);
  });

  it('R19: the workspace token never appears in workflow history', async () => {
    expect(lastSuccessHandle).toBeDefined();
    if (!lastSuccessHandle) return;
    const json = historyToJSON(await lastSuccessHandle.fetchHistory());
    expect(json).toContain('createRunSecretAndJob');
    expect(script(lastSuccessHandle.workflowId.slice('run-'.length)).secretData?.REPO_CLONE_URL).toContain(TOKEN);
    expect(json).not.toContain(TOKEN);
    // Payloads are base64 JSON: check the decoded form too.
    expect(json).not.toContain(Buffer.from(JSON.stringify(TOKEN)).toString('base64').slice(0, 20));
  });

  it('cancel while createRunSecretAndJob is in flight: deleteJob runs only after the create landed', async () => {
    const s = newRun();
    s.createLandsAfterMs = 300;
    const h = await start(s);
    await s.jobCalled.promise;
    await h.signal(signals.cancel);
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(s.calls.indexOf('create:done')).toBeGreaterThanOrEqual(0);
    expect(s.calls.indexOf('create:done')).toBeLessThan(s.calls.indexOf('deleteJob'));
    expect(count(s, 'deleteJob')).toBe(1);
    expect(count(s, 'postComment:start')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'cancelled']);
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('hard timeout while postComment(start) is in flight: deleteJob runs only after it landed', async () => {
    const s = newRun({ timeoutSeconds: 1 });
    s.startCommentLandsAfterMs = 1800;
    const h = await start(s);
    const out = await h.result();
    expect(out.status).toBe('timed_out');
    expect(s.calls.indexOf('postComment:start:done')).toBeGreaterThanOrEqual(0);
    expect(s.calls.indexOf('postComment:start:done')).toBeLessThan(s.calls.indexOf('deleteJob'));
    expect(count(s, 'followPodLogs')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'timed_out']);
    expectFinishOnce(s);
  });

  it('a turn that ends after the workflow wrote running (resumed) gets idle written again', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.resumed);
    await waitFor(() => statuses(s).length === 3, 'running written after resumed');
    await h.signal(signals.turnFinished);
    await waitFor(() => statuses(s).length === 4, 'idle re-written');
    expect(statuses(s)).toEqual(['starting', 'running', 'running', 'idle']);
    // A plain turn with no resume in between writes nothing from the workflow.
    await h.signal(signals.resumed);
    await waitFor(() => statuses(s).length === 5, 'running');
    await h.signal(signals.turnFinished);
    await waitFor(() => statuses(s).length === 6, 'idle');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
    expect(statuses(s)).toEqual(['starting', 'running', 'running', 'idle', 'running', 'idle', 'succeeded']);
  });

  it('Temporal cancellation (handle.cancel) lands in the same finalize: deleteJob, cancelled, one finish comment', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.cancel();
    const out = await h.result();
    expect(out.status).toBe('cancelled');
    expect(statuses(s)).toEqual(['starting', 'running', 'cancelled']);
    expect(count(s, 'deleteJob')).toBe(1);
    await waitFor(() => s.logsCancelled, 'followPodLogs cancelled');
    expectFinishOnce(s);
    await gateForgot(s);
  });

  it('finish while ending is ignored', async () => {
    const s = newRun({}, { endSessionExits: false });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.turnFinished);
    await waitPhase(h, 'idle');
    await h.signal(signals.finish);
    await s.endSessionCalled.promise;
    await waitPhase(h, 'ending');
    await h.signal(signals.finish);
    await h.signal(signals.resumed);
    await sleepReal(300);
    expect(count(s, 'endSession')).toBe(1);
    expect((await state(h)).phase).toBe('ending');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    expect(statuses(s)).toEqual(['starting', 'running', 'succeeded']);
    captured['run-idle-finish'] = h;
  });

  it('agentState done → done status; idle timer → endSession → succeeded', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await waitFor(() => statuses(s).length === 3, 'running written');
    await h.signal(signals.agentState, 'done');
    await waitPhase(h, 'agent_done');
    expect((await h.result()).status).toBe('succeeded');
    expect(count(s, 'endSession')).toBe(1);
    // Nothing kept: parkRun writes the final status, so the workflow writes no `succeeded` of its own.
    expect(statuses(s)).toEqual(['starting', 'running', 'running', 'done']);
    expect(count(s, 'parkRun:done')).toBe(1);
  });

  it('agentState waiting keeps running and never starts the idle timer', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'waiting');
    await sleepReal(1800);
    expect((await state(h)).phase).toBe('running');
    expect(count(s, 'endSession')).toBe(0);
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('agentState waiting while idle returns to running without a status write (the activity owns that row)', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    await h.signal(signals.agentState, 'waiting');
    await waitPhase(h, 'running');
    await sleepReal(1800);
    expect(statuses(s)).toEqual(['starting', 'running']);
    expect(count(s, 'endSession')).toBe(0);
    // A later turn end is still honoured.
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('agentState waiting while done returns to running without a status write', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'done');
    await waitPhase(h, 'agent_done');
    await h.signal(signals.agentState, 'waiting');
    await waitPhase(h, 'running');
    await sleepReal(300);
    expect(statuses(s)).toEqual(['starting', 'running']);
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('finishRun accepted, then the run is finalized before the session ends → NotFinishable, not a hang', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    // Keep the main loop busy writing `running` so it cannot reach `ending = true` before the cancel lands.
    const hold = deferred<void>();
    s.holdNextRunning = hold;
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await h.signal(signals.agentState, 'needs_input');
    await waitPhase(h, 'idle');
    const update = await h.startUpdate(signals.finishRun, { waitForStage: 'ACCEPTED' });
    await h.signal(signals.cancel);
    await expect(update.result()).rejects.toMatchObject({ cause: { type: 'NotFinishable' } });
    hold.resolve();
    expect((await h.result()).status).toBe('cancelled');
  });

  it('agentState working while done writes running and stops the idle timer', async () => {
    const s = newRun({ idleEndSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    await h.signal(signals.agentState, 'done');
    await waitPhase(h, 'agent_done');
    await h.signal(signals.agentState, 'working');
    await waitPhase(h, 'running');
    await waitFor(() => statuses(s).length === 3, 'running written');
    await sleepReal(1800);
    expect(count(s, 'endSession')).toBe(0);
    expect(statuses(s)).toEqual(['starting', 'running', 'running']);
    await expect(h.executeUpdate(signals.finishRun)).rejects.toThrow();
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('finishRun in idle and in done → accepted, endSession, succeeded', async () => {
    for (const first of ['needs_input', 'done'] as const) {
      const s = newRun();
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, first);
      await waitPhase(h, first === 'done' ? 'agent_done' : 'idle');
      expect(await h.executeUpdate(signals.finishRun)).toEqual({ accepted: true });
      expect((await h.result()).status).toBe('succeeded');
      expect(count(s, 'endSession')).toBe(1);
    }
  });

  it('finishRun while running is rejected with NotFinishable and the run keeps going', async () => {
    const s = newRun();
    const h = await start(s);
    await s.logsStarted.promise;
    await waitPhase(h, 'running');
    await expect(h.executeUpdate(signals.finishRun)).rejects.toMatchObject({
      cause: { type: 'NotFinishable', message: expect.stringContaining('phase is running') as unknown },
    });
    await sleepReal(300);
    expect(count(s, 'endSession')).toBe(0);
    expect((await state(h)).phase).toBe('running');
    s.logs.resolve({ exitCode: 0 });
    expect((await h.result()).status).toBe('succeeded');
  });

  it('hard timeout while done → succeeded; while idle → timed_out', async () => {
    const d = newRun({ timeoutSeconds: 2 });
    const hd = await start(d);
    await d.logsStarted.promise;
    await hd.signal(signals.agentState, 'done');
    await waitPhase(hd, 'agent_done');
    expect((await hd.result()).status).toBe('succeeded');
    expect(count(d, 'deleteJob')).toBe(1);

    const i = newRun({ timeoutSeconds: 2 });
    const hi = await start(i);
    await i.logsStarted.promise;
    await hi.signal(signals.agentState, 'needs_input');
    await waitPhase(hi, 'idle');
    expect((await hi.result()).status).toBe('timed_out');
  });

  it('finalize deletes the run volume once, after the Job is gone', async () => {
    const s = newRun({ timeoutSeconds: 1 });
    const h = await start(s);
    await s.logsStarted.promise;
    expect((await h.result()).status).toBe('timed_out');
    expect(count(s, 'deleteRunVolume')).toBe(1);
    expect(s.calls.indexOf('deleteJob')).toBeLessThan(s.calls.indexOf('deleteRunVolume'));
  });

  describe('pod lost and agent crash (pod-lost-parks)', () => {
    it('a pod killed while idle parks as pod_lost: paused, the volume kept', async () => {
      const s = newRun({}, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      // The pod is killed (OOM, eviction): no end line, an exit code.
      s.logs.resolve({ exitCode: 137, agentStarted: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['pod_lost']);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(count(s, 'endSession')).toBe(0);
      expect(statuses(s)).toEqual(['starting', 'running']);
      captured['run-pod-lost'] = h;
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('a pod that vanished while the agent worked parks as pod_lost', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: -1, agentStarted: true, podLost: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['pod_lost']);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('an agent that exits non-zero parks as agent_crashed (D1): paused, the volume kept, not failed', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: 1, endReason: 'agent_exit', agentStarted: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['agent_crashed']);
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      await h.signal(signals.cancel);
      await h.result();
    });

    it('an agent that exits non-zero after declaring done parks as a kept done run with agent_crashed', async () => {
      const s = newRun();
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'done');
      await waitPhase(h, 'agent_done');
      s.logs.resolve({ exitCode: 2, endReason: 'agent_exit', agentStarted: true });
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['agent_crashed']);
      expect(count(s, 'parkRun:done')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      await h.signal(signals.dropSession);
      expect((await h.result()).status).toBe('succeeded');
    });

    it('an agent that exits 0 still succeeds', async () => {
      const s = newRun();
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: 0, endReason: 'agent_exit', agentStarted: true });
      expect(await h.result()).toMatchObject({ status: 'succeeded', exitCode: 0 });
      expect(count(s, 'parkRun:needs_input')).toBe(0);
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('the idle timer parks with the idle_timeout reason', async () => {
      const s = newRun({ idleEndSeconds: 1 });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'parked');
      expect(s.parkReasons).toEqual(['idle_timeout']);
      await h.signal(signals.cancel);
      await h.result();
    });

    it('a resume sent while the session is ending is accepted and a new pod starts after the park', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 30 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      expect((await state(h)).phase).toBe('ending');
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      // Still ending: the queued resume starts nothing before the park.
      expect((await state(h)).phase).toBe('ending');
      expect(count(s, 'createRunSecretAndJob')).toBe(1);
      await expect(h.executeUpdate(signals.resumeRun)).rejects.toMatchObject({
        cause: { type: 'NotResumable', message: 'This run is already being resumed' },
      });
      s.logs.resolve({ exitCode: 0, agentStarted: true });
      await waitFor(() => count(s, 'createRunSecretAndJob') >= 2, 'resume Job');
      expect(count(s, 'parkRun:needs_input')).toBe(1);
      await h.signal(signals.sessionStarted);
      await waitFor(() => statuses(s).at(-1) === 'idle', 'idle after resume');
      await h.signal(signals.terminalAttached);
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('a resume is refused while a person Finish is ending the session', async () => {
      const s = newRun({ endingDeadlineSeconds: 30 }, { endSessionExits: false });
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await waitPhase(h, 'idle');
      await h.executeUpdate(signals.finishRun);
      await expect(h.executeUpdate(signals.resumeRun)).rejects.toMatchObject({
        cause: { type: 'NotResumable', message: 'This run is being finished' },
      });
      s.logs.resolve({ exitCode: 0, agentStarted: true });
      expect((await h.result()).status).toBe('succeeded');
    });

    it('a cancel while the session is ending still wins: cancelled, the volume deleted, no new pod', async () => {
      const s = newRun({ idleEndSeconds: 1, endingDeadlineSeconds: 30 }, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      await h.signal(signals.agentState, 'needs_input');
      await s.endSessionCalled.promise;
      expect(await h.executeUpdate(signals.resumeRun)).toEqual({ accepted: true });
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
      expect(count(s, 'deleteRunVolume')).toBe(1);
      expect(count(s, 'createRunSecretAndJob')).toBe(1);
      expect(count(s, 'parkRun:needs_input')).toBe(0);
    });
  });

  describe('follower reconnect (follower-reconnect)', () => {
    it('follower returns contactLost after session_started: parks as pod_lost, volume kept, no failed status', async () => {
      const s = newRun({}, { endSessionExits: false });
      s.parkKeepSeconds = 3600;
      const h = await start(s);
      await s.logsStarted.promise;
      s.logs.resolve({ exitCode: -1, agentStarted: true, podLost: true, contactLost: true });
      await waitParked(h);
      expect(s.parkReasons).toEqual(['pod_lost']);
      expect(count(s, 'deleteRunVolume')).toBe(0);
      expect(statuses(s)).not.toContain('failed');
      captured['run-follower-reconnect'] = h;
      await h.signal(signals.cancel);
      expect((await h.result()).status).toBe('cancelled');
    });

    it('followPodLogs throws ClusterPermanentError: failed at once, Job and volume cleaned up', async () => {
      const s = newRun();
      s.followPermanent = true;
      const h = await start(s);
      expect((await h.result()).status).toBe('failed');
      expect(count(s, 'followPodLogs')).toBe(1);
      expect(count(s, 'deleteJob')).toBe(1);
      expect(count(s, 'deleteRunVolume')).toBe(1);
    });

    it('finalize deleteJob refused with ClusterPermanentError: tried once, the run still ends timed_out', async () => {
      const s = newRun({ timeoutSeconds: 1 });
      s.deleteJobPermanent = true;
      const h = await start(s);
      expect((await h.result()).status).toBe('timed_out');
      expect(count(s, 'deleteJob')).toBe(1);
      expect(statuses(s).at(-1)).toBe('timed_out');
    });
  });

  it('replay: histories from this run and the checked-in fixtures replay without nondeterminism', async () => {
    expect(Object.keys(captured).sort()).toEqual([
      'run-cancel-loading',
      'run-cancel-starting',
      'run-follower-reconnect',
      'run-idle-finish',
      'run-pod-lost',
      'run-success',
      'run-token-refresh',
    ]);
    for (const [name, h] of Object.entries(captured)) {
      const history = await h.fetchHistory();
      await Worker.runReplayHistory({ workflowsPath }, history, h.workflowId);
      if (process.env.UPDATE_REPLAY_FIXTURES === '1') {
        // Worker identities are "pid@hostname": keep machine names out of the repo.
        const json = historyToJSON(history).replace(/"identity": "[^"]*"/g, '"identity": "replay-fixture"');
        await writeFile(fixture(name), json + '\n');
      }
    }
    // Review Focus 5: `run-idle-timer` was recorded before the pause-resume patch (idle timer, succeeded, no park). A run
    // like it must replay on the old path: parking it now would be a non-determinism error.

    for (const name of [...Object.keys(captured), 'run-idle-timer']) {
      const json: unknown = JSON.parse(await readFile(fixture(name), 'utf8'));
      await Worker.runReplayHistory({ workflowsPath }, json, `fixture-${name}`);
    }
  });
});
