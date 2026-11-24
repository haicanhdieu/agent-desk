import type { PollActivities } from './poll.activity';
import type { RunActivities } from './run.activities';
import type { SetupTestActivities } from './setup-test.activities';
import type { SyncModelPricesResult } from './price-sync.activity';

/** Activity signatures as seen from workflow code (type-only import; no runtime dependency). */
export interface Activities extends RunActivities, PollActivities, SetupTestActivities {
  sweepOutbox(): Promise<number>;
  reconcile(): Promise<void>;
  syncModelPrices(): Promise<SyncModelPricesResult>;
}
