import type { RetryPolicy } from '@temporalio/workflow';

/** Global activity retry policy (plan Global Constraints): initial 1 s, max interval 1 min, 5 attempts. */
export const ACTIVITY_RETRY: RetryPolicy = { initialInterval: '1s', maximumInterval: '1m', maximumAttempts: 5 };
