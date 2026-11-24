import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { createTimeSkippingTestEnv } from './helpers/temporal-env';
import { Worker } from '@temporalio/worker';
import { ApplicationFailure } from '@temporalio/activity';
import { ActivityFailure } from '@temporalio/common';
import { WorkflowFailedError } from '@temporalio/client';
import { TASK_QUEUE, WORKFLOW } from '@agentdesk/core';
import type { Activities } from '../src/activities/types';
import type { SyncModelPricesResult } from '../src/activities/price-sync.activity';
import type { PriceSyncInput } from '../src/workflows/price-sync.workflow';

let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const workflowsPath = fileURLToPath(new URL('../src/workflows/index.ts', import.meta.url));

/** Per-run script: the attempt number (1-based) from which the activity succeeds; 0 = never. */
let succeedOnAttempt = 0;
let calls = 0;

const stub = {
  async syncModelPrices(): Promise<SyncModelPricesResult> {
    calls += 1;
    if (succeedOnAttempt > 0 && calls >= succeedOnAttempt) return { outcome: 'created', entries: 2 };
    throw ApplicationFailure.retryable('price sync: unreachable', 'PriceSyncFailed', 'unreachable');
  },
} as unknown as Activities;

beforeAll(async () => {
  env = await createTimeSkippingTestEnv();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath,
    activities: stub as unknown as Record<string, (...args: unknown[]) => unknown>,
  });
  running = worker.run();
}, 240_000);

afterAll(async () => {
  worker.shutdown();
  await running;
  await env.teardown();
});

const run = (input?: PriceSyncInput) => {
  calls = 0;
  return env.client.workflow.start(WORKFLOW.priceSync, {
    taskQueue: TASK_QUEUE,
    workflowId: `price-sync-test-${randomUUID()}`,
    args: input === undefined ? [] : [input],
  });
};

describe('PriceSyncWorkflow', () => {
  it('retries up to 5 attempts by default and returns the activity result', async () => {
    succeedOnAttempt = 5;
    const h = await run();
    expect(await h.result()).toEqual({ outcome: 'created', entries: 2 });
    expect(calls).toBe(5);
  });

  it('fails after 5 attempts when the activity never succeeds', async () => {
    succeedOnAttempt = 0;
    const h = await run();
    await expect(h.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(calls).toBe(5);
  });

  it('maxAttempts 1 calls once and surfaces PriceSyncFailed with its kind', async () => {
    succeedOnAttempt = 0;
    const h = await run({ maxAttempts: 1 });
    const err = await h.result().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(WorkflowFailedError);
    const cause = (err as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ActivityFailure);
    const app = (cause as ActivityFailure).cause;
    expect(app).toBeInstanceOf(ApplicationFailure);
    expect((app as ApplicationFailure).type).toBe('PriceSyncFailed');
    expect((app as ApplicationFailure).details).toEqual(['unreachable']);
    expect(calls).toBe(1);
  });

  it.each([0, 6])('rejects maxAttempts %i without calling the activity', async (maxAttempts) => {
    succeedOnAttempt = 1;
    const h = await run({ maxAttempts });
    await expect(h.result()).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(calls).toBe(0);
  });

  it('replays a recorded history without nondeterminism', async () => {
    const json: unknown = JSON.parse(
      await readFile(fileURLToPath(new URL('./fixtures/price-sync-history.json', import.meta.url)), 'utf8'),
    );
    await Worker.runReplayHistory({ workflowsPath }, json, 'fixture-price-sync');
  });
});
