import { sweepOutbox, type WorkflowStarter } from '@agentdesk/core';
import type { Db } from '@agentdesk/db';
import { reconcile, type ReconcileLogger, type ReconcileTemporal } from './reconcile.activity';
import { setRunStatus, type SetRunStatusInput } from './run-status.activity';
import { createRunActivities, type RunActivityDeps } from './run.activities.impl';
import type { RequestSlotInput } from './run.activities';
import { requestSlot, type GateSignaller } from './slot.activity';
import type { Activities } from './types';

export interface ActivityDeps extends Omit<RunActivityDeps, 'db'> {
  db: Db;
  starter: WorkflowStarter;
  gate: GateSignaller;
  temporal: ReconcileTemporal;
  log?: ReconcileLogger;
}

/** Activities bound to their dependencies (the Nest providers, resolved in main.ts). */
export function createActivities(deps: ActivityDeps): Activities {
  return {
    ...createRunActivities(deps),
    setRunStatus: (input: SetRunStatusInput) => setRunStatus(deps.db, input),
    requestSlot: (input: RequestSlotInput) => requestSlot(deps.gate, input),
    sweepOutbox: () => sweepOutbox({ db: deps.db, starter: deps.starter }),
    reconcile: async (): Promise<void> => {
      await reconcile({
        db: deps.db,
        kube: deps.kube,
        temporal: deps.temporal,
        ...(deps.log ? { log: deps.log } : {}),
      });
    },
  };
}
