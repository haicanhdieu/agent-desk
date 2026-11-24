import { ApplicationFailure, proxyActivities } from '@temporalio/workflow';
import type { Activities } from '../activities/types';
import type { SyncModelPricesResult } from '../activities/price-sync.activity';

export interface PriceSyncInput {
  /** Activity attempts before the run fails (1..5, default 5). The schedule's next tick tries again. */
  maxAttempts?: number;
}

const MIN_ATTEMPTS = 1;
const MAX_ATTEMPTS = 5;

/** Scheduled every 6 h (and once at boot): refreshes the global model price catalog. */
export async function PriceSyncWorkflow(input?: PriceSyncInput): Promise<SyncModelPricesResult> {
  const maximumAttempts = input?.maxAttempts ?? MAX_ATTEMPTS;
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < MIN_ATTEMPTS || maximumAttempts > MAX_ATTEMPTS) {
    throw ApplicationFailure.nonRetryable(
      `maxAttempts must be an integer from ${MIN_ATTEMPTS} to ${MAX_ATTEMPTS}`,
      'InvalidPriceSyncInput',
    );
  }
  const act = proxyActivities<Pick<Activities, 'syncModelPrices'>>({
    startToCloseTimeout: '120 seconds',
    retry: { maximumAttempts },
  });
  return act.syncModelPrices();
}
