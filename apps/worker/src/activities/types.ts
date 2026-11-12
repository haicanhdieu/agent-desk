import type { SetRunStatusInput, SetRunStatusResult } from './run-status.activity';

/** Activity signatures as seen from workflow code (type-only import; no runtime dependency). */
export interface Activities {
  setRunStatus(input: SetRunStatusInput): Promise<SetRunStatusResult>;
  sweepOutbox(): Promise<number>;
  reconcile(): Promise<void>;
}
