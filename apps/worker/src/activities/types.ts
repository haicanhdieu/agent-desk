import type { RunActivities } from './run.activities';

/** Activity signatures as seen from workflow code (type-only import; no runtime dependency). */
export interface Activities extends RunActivities {
  sweepOutbox(): Promise<number>;
  reconcile(): Promise<void>;
}
