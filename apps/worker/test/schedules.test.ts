import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { OUTBOX_SWEEP_SCHEDULE_ID, RECONCILE_SCHEDULE_ID, TASK_QUEUE, WORKFLOW } from '@agentdesk/core';
import { ensureSchedules } from '../src/schedules';

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 240_000);
afterAll(async () => {
  await env?.teardown();
});

describe('worker wiring', () => {
  it('ensureSchedules is idempotent', async () => {
    await ensureSchedules(env.client);
    await ensureSchedules(env.client);
    for (const id of [OUTBOX_SWEEP_SCHEDULE_ID, RECONCILE_SCHEDULE_ID]) {
      const d = await env.client.schedule.getHandle(id).describe();
      expect(d.policies.overlap).toBe('SKIP');
    }
    await env.client.schedule.getHandle(OUTBOX_SWEEP_SCHEDULE_ID).delete();
    await env.client.schedule.getHandle(RECONCILE_SCHEDULE_ID).delete();
  });

  it('ensureSchedules tolerates concurrent first boots', async () => {
    await Promise.all([ensureSchedules(env.client), ensureSchedules(env.client), ensureSchedules(env.client)]);
    for (const id of [OUTBOX_SWEEP_SCHEDULE_ID, RECONCILE_SCHEDULE_ID]) {
      const d = await env.client.schedule.getHandle(id).describe();
      expect(d.policies.overlap).toBe('SKIP');
      await env.client.schedule.getHandle(id).delete();
    }
  });

  it('the production workflow bundle runs the sweep and reconcile workflows against the activities', async () => {
    const run = await runBundle(`${TASK_QUEUE}-bundle`);
    expect(run.result).toBe(3);
    expect(run.calls).toEqual(['sweep', 'reconcile']);
  });

  it('the production workflow bundle ignores a sweep the schedule already started on the production queue', async () => {
    // A slow run can straddle a 30 s schedule tick: the schedule starts a sweep on TASK_QUEUE, then the earlier test
    // deletes the schedule, but the started workflow stays queued. Force that here, deterministically.
    await ensureSchedules(env.client);
    const sweep = env.client.schedule.getHandle(OUTBOX_SWEEP_SCHEDULE_ID);
    await sweep.trigger();
    await waitUntil(async () => (await sweep.describe()).info.recentActions.length > 0);
    await sweep.delete();
    await env.client.schedule.getHandle(RECONCILE_SCHEDULE_ID).delete();

    const run = await runBundle(`${TASK_QUEUE}-bundle-after-schedule`);
    expect(run.calls).toEqual(['sweep', 'reconcile']);
  });
});

async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('condition not met within 10 s');
}

/** Runs the production workflow bundle on its own `taskQueue` (never the production one, which the schedules feed) against recording activities and starts both workflows there. */
async function runBundle(taskQueue: string): Promise<{ calls: string[]; result: number }> {
  const calls: string[] = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: fileURLToPath(new URL('../src/workflows/index.ts', import.meta.url)),
    activities: {
      sweepOutbox: async () => {
        calls.push('sweep');
        return 3;
      },
      reconcile: async () => {
        calls.push('reconcile');
      },
    },
  });
  const result = await worker.runUntil(async () => {
    const swept = await env.client.workflow.execute(WORKFLOW.outboxSweep, {
      taskQueue,
      workflowId: `sweep-${taskQueue}`,
    });
    await env.client.workflow.execute(WORKFLOW.reconcile, { taskQueue, workflowId: `rec-${taskQueue}` });
    return swept;
  });
  return { calls, result };
}
