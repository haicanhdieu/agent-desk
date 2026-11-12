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

  it('the production workflow bundle runs the sweep and reconcile workflows against the activities', async () => {
    const calls: string[] = [];
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
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
    await worker.runUntil(async () => {
      const swept = await env.client.workflow.execute(WORKFLOW.outboxSweep, {
        taskQueue: TASK_QUEUE,
        workflowId: 'sweep-test',
      });
      await env.client.workflow.execute(WORKFLOW.reconcile, { taskQueue: TASK_QUEUE, workflowId: 'rec-test' });
      expect(swept).toBe(3);
    });
    expect(calls).toEqual(['sweep', 'reconcile']);
  });
});
