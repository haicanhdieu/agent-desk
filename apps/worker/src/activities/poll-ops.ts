import { ScheduleNotFoundError, type Client } from '@temporalio/client';
import { TASK_QUEUE, WORKFLOW, pollResumeWorkflowId, pollScheduleId } from '@agentdesk/core';
import type { PollScheduleOps } from './poll.activity';

const tolerateMissing = async (fn: () => Promise<unknown>): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof ScheduleNotFoundError)) throw err;
  }
};

/** Poll Schedule control through a Temporal Client (used by activities; workflow code cannot hold handles). */
export function pollScheduleOps(client: Client): PollScheduleOps {
  const handle = (projectId: string) => client.schedule.getHandle(pollScheduleId(projectId));
  return {
    pause: (projectId, note) => tolerateMissing(() => handle(projectId).pause(note)),
    unpause: (projectId) => tolerateMissing(() => handle(projectId).unpause('rate limit lifted')),
    remove: (projectId) => tolerateMissing(() => handle(projectId).delete()),
    async startResume(input) {
      await client.workflow.start(WORKFLOW.resumePoll, {
        taskQueue: TASK_QUEUE,
        workflowId: pollResumeWorkflowId(input.projectId),
        // A timer already waiting for this project is kept: ticks are skipped by next_poll_at until it fires.
        workflowIdConflictPolicy: 'USE_EXISTING',
        args: [input],
      });
    },
  };
}
