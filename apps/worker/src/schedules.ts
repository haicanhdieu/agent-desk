import { ScheduleAlreadyRunning, ScheduleOverlapPolicy, type Client, type ScheduleOptions } from '@temporalio/client';
import { OUTBOX_SWEEP_SCHEDULE_ID, RECONCILE_SCHEDULE_ID, TASK_QUEUE, WORKFLOW } from '@agentdesk/core';

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
  ];
}

/** Creates the schedules if missing; otherwise updates them to the current definition. Safe to run on every boot,
 * including concurrently from several replicas (create losing the race falls through to update). */
export async function ensureSchedules(client: Client): Promise<void> {
  for (const { id, options } of scheduleDefinitions()) {
    const update = () => client.schedule.getHandle(id).update((prev) => ({ ...prev, ...options, state: prev.state }));
    try {
      await client.schedule.create({ scheduleId: id, ...options });
    } catch (err) {
      if (!(err instanceof ScheduleAlreadyRunning)) throw err;
      await update();
    }
  }
}
