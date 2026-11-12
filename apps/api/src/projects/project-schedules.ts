import { Inject, Injectable } from '@nestjs/common';
import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  type Client,
  type ScheduleOptions,
} from '@temporalio/client';
import { SIGNAL, TASK_QUEUE, WORKFLOW, gateWorkflowId, pollScheduleId } from '@agentdesk/core';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';

export interface ScheduledProject {
  id: string;
  triggerMode: string;
  pollIntervalSeconds: number;
}

@Injectable()
export class ProjectSchedules {
  constructor(@Inject(TEMPORAL_CLIENT) private readonly client: Client) {}

  /**
   * Makes the Temporal Schedule `poll-{projectId}` match the project: present at its interval in polling mode,
   * absent in webhook mode. `exists` (when known) picks update over create; otherwise create falls back to update.
   */
  async sync(orgId: string, project: ScheduledProject, opts: { exists?: boolean } = {}): Promise<void> {
    const scheduleId = pollScheduleId(project.id);
    if (project.triggerMode !== 'polling') {
      await this.remove(project.id);
      return;
    }
    const every = project.pollIntervalSeconds * 1000;
    const options: ScheduleOptions = {
      scheduleId,
      spec: { intervals: [{ every }] },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
      action: {
        type: 'startWorkflow',
        workflowType: WORKFLOW.pollOnce,
        taskQueue: TASK_QUEUE,
        args: [{ orgId, projectId: project.id }],
      },
    };
    const update = () =>
      this.client.schedule
        .getHandle(scheduleId)
        .update((prev) => ({ ...prev, spec: { ...prev.spec, intervals: [{ every }] } }));
    if (opts.exists) {
      try {
        await update();
      } catch (err) {
        if (!(err instanceof ScheduleNotFoundError)) throw err;
        await this.client.schedule.create(options);
      }
      return;
    }
    try {
      await this.client.schedule.create(options);
    } catch (err) {
      if (!(err instanceof ScheduleAlreadyRunning)) throw err;
      await update();
    }
  }

  /** Deletes the project's poll schedule; a missing schedule is fine. */
  async remove(projectId: string): Promise<void> {
    try {
      await this.client.schedule.getHandle(pollScheduleId(projectId)).delete();
    } catch (err) {
      if (!(err instanceof ScheduleNotFoundError)) throw err;
    }
  }

  /** Sets the project's concurrency limit; `signalWithStart` so it works before the gate workflow exists. */
  async setLimit(projectId: string, limit: number): Promise<void> {
    const workflowId = gateWorkflowId(projectId);
    await this.client.workflow.signalWithStart(WORKFLOW.projectGate, {
      workflowId,
      taskQueue: TASK_QUEUE,
      args: [{ projectId, limit }],
      signal: SIGNAL.setLimit,
      signalArgs: [limit],
    });
  }
}
