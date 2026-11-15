import { describe, expect, it } from 'vitest';
import { ScheduleNotFoundError, type Client } from '@temporalio/client';
import { TASK_QUEUE, WORKFLOW, pollResumeWorkflowId, pollScheduleId } from '@agentdesk/core';
import { pollScheduleOps } from '../src/activities/poll-ops';

interface ScheduleHandle {
  pause: (note?: string) => Promise<void>;
  unpause: (note?: string) => Promise<void>;
  delete: () => Promise<void>;
}

/** A fake Temporal client that records schedule and workflow calls. */
function fake(handle: Partial<ScheduleHandle> = {}) {
  const ids: string[] = [];
  const started: unknown[][] = [];
  const calls: string[] = [];
  const full: ScheduleHandle = {
    pause: async (note) => void calls.push(`pause:${note}`),
    unpause: async (note) => void calls.push(`unpause:${note}`),
    delete: async () => void calls.push('delete'),
    ...handle,
  };
  const client = {
    schedule: {
      getHandle: (id: string) => {
        ids.push(id);
        return full;
      },
    },
    workflow: {
      start: async (...args: unknown[]) => void started.push(args),
    },
  } as unknown as Client;
  return { ops: pollScheduleOps(client), ids, started, calls };
}

const missing = async (): Promise<void> => {
  throw new ScheduleNotFoundError('gone', 'poll-p1');
};

describe('pollScheduleOps', () => {
  it('pauses, unpauses and removes the project schedule', async () => {
    const { ops, ids, calls } = fake();
    await ops.pause('p1', 'rate limited');
    await ops.unpause('p1');
    await ops.remove('p1');
    expect(ids).toEqual([pollScheduleId('p1'), pollScheduleId('p1'), pollScheduleId('p1')]);
    expect(calls).toEqual(['pause:rate limited', 'unpause:rate limit lifted', 'delete']);
  });

  it('tolerates a schedule that does not exist', async () => {
    const { ops } = fake({ pause: missing, unpause: missing, delete: missing });
    await expect(ops.pause('p1', 'n')).resolves.toBeUndefined();
    await expect(ops.unpause('p1')).resolves.toBeUndefined();
    await expect(ops.remove('p1')).resolves.toBeUndefined();
  });

  it('rethrows any other schedule error', async () => {
    const { ops } = fake({
      pause: async () => {
        throw new Error('server down');
      },
    });
    await expect(ops.pause('p1', 'n')).rejects.toThrow('server down');
  });

  it('starts the resume workflow, reusing one that already waits', async () => {
    const { ops, started } = fake();
    const input = { orgId: 'o1', projectId: 'p1', until: '2026-01-01T00:00:00.000Z' };
    await ops.startResume(input);
    expect(started).toHaveLength(1);
    expect(started[0]).toEqual([
      WORKFLOW.resumePoll,
      expect.objectContaining({
        taskQueue: TASK_QUEUE,
        workflowId: pollResumeWorkflowId('p1'),
        workflowIdConflictPolicy: 'USE_EXISTING',
        args: [input],
      }),
    ]);
  });
});
