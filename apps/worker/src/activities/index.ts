import { sweepOutbox, type WorkflowStarter } from '@agentdesk/core';
import type { Db } from '@agentdesk/db';
import { setRunStatus, type SetRunStatusInput } from './run-status.activity';
import type { RequestSlotInput } from './run.activities';
import { requestSlot, type GateSignaller } from './slot.activity';

export interface ActivityDeps {
  db: Db;
  starter: WorkflowStarter;
  gate: GateSignaller;
}

/** Activities bound to their dependencies (the Nest providers, resolved in main.ts). */
export function createActivities(deps: ActivityDeps) {
  return {
    setRunStatus: (input: SetRunStatusInput) => setRunStatus(deps.db, input),
    requestSlot: (input: RequestSlotInput) => requestSlot(deps.gate, input),
    sweepOutbox: () => sweepOutbox({ db: deps.db, starter: deps.starter }),
    /** STUB: Task 14 replaces this with the real reconcile pass. */
    reconcile: async (): Promise<void> => undefined,
  };
}
