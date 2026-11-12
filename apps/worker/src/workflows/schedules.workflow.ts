import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities/types';
import { ACTIVITY_RETRY } from './retry';

const act = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: ACTIVITY_RETRY,
});

/** Scheduled every 30 s: starts workflows for runs stuck `queued` without one. */
export async function OutboxSweepWorkflow(): Promise<number> {
  return act.sweepOutbox();
}

/** Scheduled daily. */
export async function ReconcileWorkflow(): Promise<void> {
  await act.reconcile();
}
