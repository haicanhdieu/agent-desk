import { ScheduleAlreadyRunning, ScheduleOverlapPolicy, type Client, type ScheduleOptions } from '@temporalio/client';
import {
  OUTBOX_SWEEP_SCHEDULE_ID,
  PRICE_SYNC_SCHEDULE_ID,
  PRICE_SYNC_WORKFLOW_ID,
  RECONCILE_SCHEDULE_ID,
  TASK_QUEUE,
  WORKFLOW,
} from '@agentdesk/core';

export function scheduleDefinitions(): { id: string; options: Omit<ScheduleOptions, 'scheduleId'> }[] {
  return [
    {
      id: OUTBOX_SWEEP_SCHEDULE_ID,
      options: {
        spec: { intervals: [{ every: '30s' }] },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
        action: {
          type: 'startWorkflow',
          workflowType: WORKFLOW.outboxSweep,
          taskQueue: TASK_QUEUE,
          workflowId: 'outbox-sweep-run',
        },
      },
    },
    {
      id: RECONCILE_SCHEDULE_ID,
      options: {
        spec: { intervals: [{ every: '1d' }] },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
        action: {
          type: 'startWorkflow',
          workflowType: WORKFLOW.reconcile,
          taskQueue: TASK_QUEUE,
          workflowId: 'reconcile-daily-run',
        },
      },
    },
    {
      id: PRICE_SYNC_SCHEDULE_ID,
      options: {
        spec: { intervals: [{ every: '6h' }] },
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
        action: {
          type: 'startWorkflow',
          workflowType: WORKFLOW.priceSync,
          taskQueue: TASK_QUEUE,
          workflowId: PRICE_SYNC_WORKFLOW_ID,
        },
      },
    },
  ];
}

/** Creates the schedules if missing; otherwise updates them to the current definition. Safe to run on every boot,
 * including concurrently from several replicas (create losing the race falls through to update). */
export async function ensureSchedules(client: Client): Promise<void> {
  for (const { id, options } of scheduleDefinitions()) {
    const update = () => client.schedule.getHandle(id).update((prev) => ({ ...prev, ...options, state: prev.state }));
    try {
      // The price catalog should not wait 6 h after a fresh boot: run once at creation.
      const state = id === PRICE_SYNC_SCHEDULE_ID ? { triggerImmediately: true } : undefined;
      await client.schedule.create({ scheduleId: id, ...options, ...(state ? { state } : {}) });
    } catch (err) {
      if (!(err instanceof ScheduleAlreadyRunning)) throw err;
      await update();
    }
  }
}
