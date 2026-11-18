import {
  ActivityCancellationType,
  CancellationScope,
  condition,
  isCancellation,
  patched,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type { SetupTestActivities, SetupTestRef, SetupTestResult } from '../activities/setup-test.activities';
import { ACTIVITY_RETRY as RETRY } from './retry';
import { endSetupTest } from './signals';

export type SetupTestWorkflowInput = SetupTestRef;

export interface SetupTestOutcome {
  status: 'passed' | 'failed' | 'ended';
}

/** The pod is given up to this long to reach a setup result (pod Pending limit plus the longest setup timeout). */
const FOLLOW_TIMEOUT = '1 hour';
/** `followSetupTestLogs` heartbeats every 10 s. */
const FOLLOW_HEARTBEAT_TIMEOUT = '1 minute';

/**
 * Executions started before the result stopped being kept for a TTL recorded a timer after the follow step. They
 * replay on that path (create's `{ ttlSeconds }` result, then the wait); new ones finalize at once.
 */
const NO_TTL_PATCH = 'setup-test-no-ttl';

/**
 * Create must settle before `finalize` runs: a Job created after finalize's deletes would be orphaned with a live
 * token. On cancel the workflow waits for the in-flight attempt (cancelling still stops retries).
 */
const settled = proxyActivities<{
  /** The activity now returns nothing; an execution started before `NO_TTL_PATCH` recorded `{ ttlSeconds }`. */
  createSetupTestJob(ref: SetupTestRef): Promise<{ ttlSeconds?: number } | undefined>;
}>({
  startToCloseTimeout: '2 minutes',
  retry: RETRY,
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
});
const follow = proxyActivities<Pick<SetupTestActivities, 'followSetupTestLogs'>>({
  startToCloseTimeout: FOLLOW_TIMEOUT,
  heartbeatTimeout: FOLLOW_HEARTBEAT_TIMEOUT,
  retry: RETRY,
});
const fin = proxyActivities<Pick<SetupTestActivities, 'finalizeSetupTest'>>({
  startToCloseTimeout: '2 minutes',
  retry: RETRY,
});

/**
 * Spec §5.3, ADR 0025. One setup test: create the Job, follow its logs until the setup result is recorded, then always
 * `finalize` (non-cancellable), which deletes the Job and Secret, clears the script and marks the test ended. The pod
 * is not kept after the result (pass or fail): the stored result and log are what the UI shows.
 *
 * The `endSetupTest` signal cancels steps 1-2 of a test still in flight (the user ended it, or a newer test
 * superseded it) and goes on to finalize. A failure of create or follow (or a cancellation of the workflow itself)
 * still finalizes, then fails the workflow. Only the ids enter the workflow input and every activity argument: the
 * script body is read from the database inside the activities.
 */
export async function SetupTestWorkflow(input: SetupTestWorkflowInput): Promise<SetupTestOutcome> {
  const ref: SetupTestRef = { orgId: input.orgId, setupTestId: input.setupTestId };
  let ended = false;
  const noTtl = patched(NO_TTL_PATCH);
  let legacyTtlSeconds = 0;
  const state: { result: SetupTestResult } = { result: null };
  const body = new CancellationScope();
  setHandler(endSetupTest, () => {
    ended = true;
    body.cancel();
  });

  try {
    try {
      await body.run(async () => {
        legacyTtlSeconds = (await settled.createSetupTestJob(ref))?.ttlSeconds ?? 0;
        state.result = await follow.followSetupTestLogs(ref);
      });
    } catch (err) {
      // Our own end signal cancelled the body: carry on to finalize. Anything else (including a cancel of the whole
      // workflow) is rethrown after finalize.
      if (!(ended && isCancellation(err))) throw err;
    }
    // Pre-patch executions keep the workspace for the TTL once there is a result, or until the end signal.
    if (!noTtl && state.result !== null) await condition(() => ended, legacyTtlSeconds * 1000);
  } finally {
    await CancellationScope.nonCancellable(() => fin.finalizeSetupTest(ref));
  }
  return { status: state.result?.status ?? 'ended' };
}
