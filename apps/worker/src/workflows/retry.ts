import type { RetryPolicy } from '@temporalio/workflow';

/** Global activity retry policy (plan Global Constraints): initial 1 s, max interval 1 min, 5 attempts. */
export const ACTIVITY_RETRY: RetryPolicy = { initialInterval: '1s', maximumInterval: '1m', maximumAttempts: 5 };

/** Cluster calls (follower, Job delete, session end): no attempt cap, so an API outage parks the run instead of failing it. */
export const CLUSTER_RETRY: RetryPolicy = { initialInterval: '1s', maximumInterval: '1m', maximumAttempts: 0 };
