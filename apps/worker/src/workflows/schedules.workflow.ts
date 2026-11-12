import { proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities/types';

const act = proxyActivities<Activities>({
  startToCloseTimeout: '2 minutes',
  retry: { initialInterval: '1s', maximumInterval: '1m', maximumAttempts: 5 },
});

/** Scheduled every 30 s: starts workflows for runs stuck `queued` without one. */
export async function OutboxSweepWorkflow(): Promise<number> {
  return act.sweepOutbox();
}

/** Scheduled daily. */
export async function ReconcileWorkflow(): Promise<void> {
  await act.reconcile();
}
