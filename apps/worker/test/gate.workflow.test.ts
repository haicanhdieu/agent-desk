import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { WorkflowHandle } from '@temporalio/client';
import { GATE_CONTINUE_AS_NEW_AFTER, SIGNAL, gateWorkflowId, runWorkflowId } from '@agentdesk/core';
import * as signals from '../src/workflows/signals';
import { gateState, type GateState } from '../src/workflows/signals';
import { CONTINUE_AS_NEW_AFTER } from '../src/workflows/gate.workflow';
import { grantsQuery } from './stub-workflows';

let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const TQ = 'gate-test';
let n = 0;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TQ,
    workflowsPath: fileURLToPath(new URL('./stub-workflows.ts', import.meta.url)),
  });
  running = worker.run();
}, 240_000);

afterAll(async () => {
  worker.shutdown();
  await running;
  await env.teardown();
});

async function startRuns(ids: string[]): Promise<Record<string, WorkflowHandle>> {
  const out: Record<string, WorkflowHandle> = {};
  for (const id of ids) {
    out[id] = await env.client.workflow.start('RunStub', { taskQueue: TQ, workflowId: runWorkflowId(id) });
  }
  return out;
}

async function startGate(limit: number) {
  n += 1;
  const projectId = `p${n}-${Date.now()}`;
  const gate = await env.client.workflow.start('ProjectGateWorkflow', {
    taskQueue: TQ,
    workflowId: gateWorkflowId(projectId),
    args: [{ projectId, limit }],
  });
  return gate;
}

const grants = (h: WorkflowHandle) => h.query<number>(grantsQuery);
/** Polls the gate's read-only state query until every signal sent so far has been processed and granted. */
async function settle(gate: WorkflowHandle): Promise<GateState> {
  for (let i = 0; i < 200; i += 1) {
    const st = await gate.query<GateState>(gateState);
    if (st.settled) return st;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('gate did not settle');
}
describe('constants', () => {
  it('signal names and thresholds match the shared names', () => {
    expect(signals.requestSlot.name).toBe(SIGNAL.requestSlot);
    expect(signals.releaseSlot.name).toBe(SIGNAL.releaseSlot);
    expect(signals.setLimit.name).toBe(SIGNAL.setLimit);
    expect(signals.granted.name).toBe(SIGNAL.granted);
    expect(signals.cancel.name).toBe(SIGNAL.cancel);
    expect(signals.finish.name).toBe(SIGNAL.finish);
    expect(signals.turnFinished.name).toBe(SIGNAL.turnFinished);
    expect(signals.resumed.name).toBe(SIGNAL.resumed);
    expect(signals.terminalAttached.name).toBe(SIGNAL.terminalAttached);
    expect(signals.terminalDetached.name).toBe(SIGNAL.terminalDetached);
    expect(CONTINUE_AS_NEW_AFTER).toBe(GATE_CONTINUE_AS_NEW_AFTER);
  });
});

describe('ProjectGateWorkflow', () => {
  it('limit 1: grants FIFO, one at a time', async () => {
    const r = await startRuns(['A1', 'B1', 'C1', 'D1']);
    const gate = await startGate(1);
    for (const id of ['A1', 'B1', 'C1', 'D1']) await gate.signal(signals.requestSlot, id);
    await settle(gate);
    expect(await Promise.all(['A1', 'B1', 'C1', 'D1'].map((id) => grants(r[id]!)))).toEqual([1, 0, 0, 0]);
    await gate.signal(signals.releaseSlot, 'A1');
    await settle(gate);
    expect(await Promise.all(['A1', 'B1', 'C1', 'D1'].map((id) => grants(r[id]!)))).toEqual([1, 1, 0, 0]);
    await gate.signal(signals.releaseSlot, 'B1');
    await settle(gate);
    expect(await Promise.all(['A1', 'B1', 'C1', 'D1'].map((id) => grants(r[id]!)))).toEqual([1, 1, 1, 0]);
    await gate.signal(signals.releaseSlot, 'C1');
    await settle(gate);
    expect(await grants(r['D1']!)).toBe(1);
    await gate.terminate();
  });

  it('setLimit(2) grants the waiting run immediately', async () => {
    const r = await startRuns(['A2', 'B2']);
    const gate = await startGate(1);
    await gate.signal(signals.requestSlot, 'A2');
    await gate.signal(signals.requestSlot, 'B2');
    await settle(gate);
    expect(await grants(r['B2']!)).toBe(0);
    await gate.signal(signals.setLimit, 2);
    await settle(gate);
    expect(await grants(r['B2']!)).toBe(1);
    await gate.terminate();
  });

  it('releaseSlot on a waiting run removes it; it is never granted', async () => {
    const r = await startRuns(['A3', 'B3', 'C3']);
    const gate = await startGate(1);
    for (const id of ['A3', 'B3', 'C3']) await gate.signal(signals.requestSlot, id);
    await gate.signal(signals.releaseSlot, 'B3');
    await gate.signal(signals.releaseSlot, 'A3');
    await settle(gate);
    expect(await grants(r['B3']!)).toBe(0);
    expect(await grants(r['C3']!)).toBe(1);
    await gate.terminate();
  });

  it('requestSlot is idempotent: queued once, active re-sends granted', async () => {
    const r = await startRuns(['A4', 'B4']);
    const gate = await startGate(1);
    await gate.signal(signals.requestSlot, 'A4');
    await gate.signal(signals.requestSlot, 'B4');
    await gate.signal(signals.requestSlot, 'B4');
    await settle(gate);
    await gate.signal(signals.requestSlot, 'A4');
    await settle(gate);
    expect(await grants(r['A4']!)).toBe(2);
    await gate.signal(signals.releaseSlot, 'A4');
    await settle(gate);
    expect(await grants(r['B4']!)).toBe(1);
    await gate.signal(signals.releaseSlot, 'B4');
    await settle(gate);
    // B4 was queued once only: nothing else is waiting, so a new request is granted again exactly once.
    expect(await grants(r['B4']!)).toBe(1);
    await gate.terminate();
  });

  it('continues as new after the signal threshold and keeps queue and active state', async () => {
    const r = await startRuns(['A5', 'B5', 'C5']);
    const gate = await startGate(1);
    await gate.signal(signals.requestSlot, 'A5');
    await gate.signal(signals.requestSlot, 'B5');
    await gate.signal(signals.requestSlot, 'C5');
    // Noise: releasing unknown runs counts as handled signals without changing state.
    for (let i = 0; i < GATE_CONTINUE_AS_NEW_AFTER; i += 1) await gate.signal(signals.releaseSlot, `noise-${i}`);
    const latest = env.client.workflow.getHandle(gate.workflowId);
    await settle(latest);
    const desc = await latest.describe();
    expect(desc.runId).not.toBe(gate.firstExecutionRunId);
    expect(desc.status.name).toBe('RUNNING');
    // The carried state works: A5 (active) is released, B5 is next, C5 still waits.
    await latest.signal(signals.releaseSlot, 'A5');
    await settle(latest);
    expect(await grants(r['B5']!)).toBe(1);
    expect(await grants(r['C5']!)).toBe(0);
    await latest.terminate();
  });
});
