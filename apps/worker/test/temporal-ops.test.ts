import { describe, expect, it } from 'vitest';
import { WorkflowNotFoundError, type Client } from '@temporalio/client';
import { QUERY, SIGNAL, WORKFLOW, gateWorkflowId, runWorkflowId } from '@agentdesk/core';
import { temporalOps } from '../src/activities/temporal-ops';

interface Handle {
  signal?: (name: string, ...args: unknown[]) => Promise<void>;
  describe?: () => Promise<{ status: { name: string } }>;
  query?: (name: string) => Promise<unknown>;
}

/** A fake Temporal client: records the workflow ids asked for, and hands out the given handle. */
function fakeClient(handle: Handle, listed: { workflowId: string }[] = []) {
  const asked: string[] = [];
  const queries: string[] = [];
  const client = {
    workflow: {
      getHandle: (id: string) => {
        asked.push(id);
        return handle;
      },
      list: ({ query }: { query: string }) => {
        queries.push(query);
        return (async function* () {
          for (const wf of listed) yield wf;
        })();
      },
    },
  } as unknown as Client;
  return { ops: temporalOps(client), asked, queries };
}

const notFound = () => new WorkflowNotFoundError('gone', 'wf', 'run');

describe('temporalOps.signalRun', () => {
  it('signals the run workflow without an argument when none is given', async () => {
    const calls: unknown[][] = [];
    const { ops, asked } = fakeClient({
      signal: async (...args) => {
        calls.push(args);
      },
    });
    await ops.signalRun('r1', SIGNAL.resumed);
    expect(asked).toEqual([runWorkflowId('r1')]);
    expect(calls).toEqual([[SIGNAL.resumed]]);
  });

  it('passes the agent state as the signal argument', async () => {
    const calls: unknown[][] = [];
    const { ops } = fakeClient({
      signal: async (...args) => {
        calls.push(args);
      },
    });
    await ops.signalRun('r1', SIGNAL.agentState, 'needs_input');
    expect(calls).toEqual([[SIGNAL.agentState, 'needs_input']]);
  });

  it('ignores a workflow that already closed', async () => {
    const { ops } = fakeClient({
      signal: async () => {
        throw notFound();
      },
    });
    await expect(ops.signalRun('r1', SIGNAL.agentState, 'done')).resolves.toBeUndefined();
  });

  it('rethrows any other signal error', async () => {
    const { ops } = fakeClient({
      signal: async () => {
        throw new Error('server down');
      },
    });
    await expect(ops.signalRun('r1', SIGNAL.agentState, 'done')).rejects.toThrow('server down');
  });
});

describe('temporalOps.isWorkflowOpen', () => {
  it('is true only for a RUNNING workflow', async () => {
    const running = fakeClient({ describe: async () => ({ status: { name: 'RUNNING' } }) });
    const done = fakeClient({ describe: async () => ({ status: { name: 'COMPLETED' } }) });
    expect(await running.ops.isWorkflowOpen('w')).toBe(true);
    expect(await done.ops.isWorkflowOpen('w')).toBe(false);
  });

  it('is false for an unknown workflow and rethrows other errors', async () => {
    const missing = fakeClient({
      describe: async () => {
        throw notFound();
      },
    });
    const broken = fakeClient({
      describe: async () => {
        throw new Error('boom');
      },
    });
    expect(await missing.ops.isWorkflowOpen('w')).toBe(false);
    await expect(broken.ops.isWorkflowOpen('w')).rejects.toThrow('boom');
  });
});

describe('temporalOps gate helpers', () => {
  it('lists the project ids of open gate workflows and skips other workflows', async () => {
    const { ops, queries } = fakeClient({}, [
      { workflowId: 'gate-p1' },
      { workflowId: 'run-r1' },
      { workflowId: 'gate-p2' },
    ]);
    expect(await ops.listOpenGateProjectIds()).toEqual(['p1', 'p2']);
    expect(queries[0]).toContain(WORKFLOW.projectGate);
  });

  it('gateRuns returns active runs followed by the queue', async () => {
    const names: string[] = [];
    const { ops, asked } = fakeClient({
      query: async (name) => {
        names.push(name);
        return { active: ['a1'], queue: ['q1', 'q2'] };
      },
    });
    expect(await ops.gateRuns('p1')).toEqual(['a1', 'q1', 'q2']);
    expect(asked).toEqual([gateWorkflowId('p1')]);
    expect(names).toEqual([QUERY.gateState]);
  });

  it('releaseSlot signals the project gate with the run id', async () => {
    const calls: unknown[][] = [];
    const { ops, asked } = fakeClient({
      signal: async (...args) => {
        calls.push(args);
      },
    });
    await ops.releaseSlot('p1', 'r1');
    expect(asked).toEqual([gateWorkflowId('p1')]);
    expect(calls).toEqual([[SIGNAL.releaseSlot, 'r1']]);
  });
});
