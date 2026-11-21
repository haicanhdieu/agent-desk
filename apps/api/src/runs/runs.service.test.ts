import { ConflictException } from '@nestjs/common';
import { ApplicationFailure, WorkflowNotFoundError, WorkflowUpdateFailedError, type Client } from '@temporalio/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@agentdesk/db';
import { UPDATE, runWorkflowId } from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { RunsService } from './runs.service';

const withOrg = vi.hoisted(() => vi.fn());
vi.mock('@agentdesk/db', async (orig) => ({ ...(await orig<typeof import('@agentdesk/db')>()), withOrg }));

const org = { orgId: 'org1' } as OrgContext;
const executeUpdate = vi.fn();
const getHandle = vi.fn(() => ({ executeUpdate }));
const service = new RunsService({} as Db, { workflow: { getHandle } } as unknown as Client);

/** The run row `loadRun` returns; only the fields the close/refuse checks read. */
const row = (over: { status?: string; reopenedAt?: Date | null } = {}) => ({
  id: 'run1',
  status: 'succeeded',
  workflowId: 'wf',
  sessionEndingAt: null,
  reopenedAt: null,
  ...over,
});

const REOPENED = new Date('2026-01-01T00:00:00.000Z');

beforeEach(() => {
  executeUpdate.mockReset();
  getHandle.mockClear();
  withOrg.mockReset();
});

describe('a reopened session of a succeeded run (ADR 0032)', () => {
  it.each(['cancel', 'stop', 'finish'] as const)('%s is refused with a pointer to Close session', async (action) => {
    withOrg.mockResolvedValue(row({ reopenedAt: REOPENED }));
    await expect(service[action](org, 'run1')).rejects.toThrow(/Close the session instead/);
    expect(getHandle).not.toHaveBeenCalled();
  });

  describe('closeSession', () => {
    const failure = (type: string) =>
      new WorkflowUpdateFailedError('failed', ApplicationFailure.nonRetryable('no', type));

    beforeEach(() => withOrg.mockResolvedValue(row({ reopenedAt: REOPENED })));

    it('runs the finish update on the run workflow', async () => {
      executeUpdate.mockResolvedValue({ accepted: true });
      await service.closeSession(org, 'run1');
      expect(getHandle).toHaveBeenCalledWith(runWorkflowId('run1'));
      expect(executeUpdate).toHaveBeenCalledWith(UPDATE.finishRun);
    });

    it('is refused for a run that is not reopened, without touching the workflow', async () => {
      withOrg.mockResolvedValue(row());
      await expect(service.closeSession(org, 'run1')).rejects.toThrow('Only a reopened session can be closed');
      expect(getHandle).not.toHaveBeenCalled();
    });

    it('is a 409 when the workflow is gone', async () => {
      executeUpdate.mockRejectedValue(new WorkflowNotFoundError('gone', 'wf', undefined));
      await expect(service.closeSession(org, 'run1')).rejects.toThrow('Run is no longer active');
    });

    it('is a 409 with the workflow message when the session cannot be closed now', async () => {
      executeUpdate.mockRejectedValue(failure('NotFinishable'));
      const err: unknown = await service.closeSession(org, 'run1').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe('no');
    });

    it('is a 409 when the workflow completed while the update was accepted', async () => {
      executeUpdate.mockRejectedValue(failure('AcceptedUpdateCompletedWorkflow'));
      await expect(service.closeSession(org, 'run1')).rejects.toThrow('Run is no longer active');
    });

    it('rethrows an unexpected failure', async () => {
      const boom = new Error('boom');
      executeUpdate.mockRejectedValue(boom);
      await expect(service.closeSession(org, 'run1')).rejects.toBe(boom);
    });
  });
});
