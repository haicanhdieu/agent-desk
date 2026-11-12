import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import type { PollInput, PollOutcome } from '../src/activities/poll.activity';

let env: TestWorkflowEnvironment;
let worker: Worker;
let running: Promise<void>;
const TQ = 'poll-retry-test';
let attempts = 0;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TQ,
    workflowsPath: fileURLToPath(new URL('../src/workflows/index.ts', import.meta.url)),
    activities: {
      pollOnce: async (_i: PollInput): Promise<PollOutcome> => {
        attempts += 1;
        if (attempts < 5) throw new Error(`transient ${attempts}`);
        return 'ok';
      },
    },
  });
  running = worker.run();
}, 240_000);

afterAll(async () => {
  worker.shutdown();
  await running;
  await env.teardown();
});

describe('PollOnceWorkflow retry policy', () => {
  it('uses the global activity retry policy: 1 s initial, 1 min max interval, 5 attempts', async () => {
    const handle = await env.client.workflow.start('PollOnceWorkflow', {
      taskQueue: TQ,
      workflowId: `poll-retry-${Date.now()}`,
      args: [{ orgId: 'o', projectId: 'p' }],
    });
    // The fifth attempt succeeds, which a 3-attempt policy would never reach.
    expect(await handle.result()).toBe('ok');
    expect(attempts).toBe(5);
    const history = await handle.fetchHistory();
    const scheduled = history.events?.find(
      (e) => e.activityTaskScheduledEventAttributes,
    )?.activityTaskScheduledEventAttributes;
    const policy = scheduled?.retryPolicy;
    expect(policy?.maximumAttempts).toBe(5);
    expect(Number(policy?.initialInterval?.seconds)).toBe(1);
    expect(Number(policy?.maximumInterval?.seconds)).toBe(60);
  }, 120_000);
});
