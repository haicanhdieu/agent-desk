import { sweepOutbox, type Config, type WorkflowStarter } from '@agentdesk/core';
import type { Db } from '@agentdesk/db';
import { pausePollSchedule, pollOnce, resumePollSchedule, type PollDeps, type PollScheduleOps } from './poll.activity';
import { reconcile, type ReconcileLogger, type ReconcileTemporal } from './reconcile.activity';
import { setRunStatus, type SetRunStatusInput } from './run-status.activity';
import { createRunActivities, type RunActivityDeps } from './run.activities.impl';
import type { RequestSlotInput } from './run.activities';
import { createSetupTestActivities } from './setup-test.activities.impl';
import { requestSlot, type GateSignaller } from './slot.activity';
import type { Activities } from './types';

export interface ActivityDeps extends Omit<RunActivityDeps, 'db' | 'config'> {
  config: RunActivityDeps['config'] & Pick<Config, 'POLL_MAX_BACKOFF_SECONDS' | 'SETUP_TEST_TTL_SECONDS'>;
  db: Db;
  starter: WorkflowStarter;
  gate: GateSignaller;
  temporal: ReconcileTemporal;
  pollSchedules: PollScheduleOps;
  log?: ReconcileLogger;
}

/** Activities bound to their dependencies (the Nest providers, resolved in main.ts). */
export function createActivities(deps: ActivityDeps): Activities {
  const pollDeps: PollDeps = {
    db: deps.db,
    registry: deps.adapters,
    starter: deps.starter,
    clock: deps.clock,
    config: deps.config,
    schedules: deps.pollSchedules,
    ...(deps.log ? { log: deps.log } : {}),
  };
  return {
    ...createRunActivities(deps),
    ...createSetupTestActivities({
      db: deps.db,
      kube: deps.kube,
      adapters: deps.adapters,
      clock: deps.clock,
      config: deps.config,
      ...(deps.timing ? { timing: deps.timing } : {}),
    }),
    setRunStatus: (input: SetRunStatusInput) => setRunStatus(deps.db, input),
    requestSlot: (input: RequestSlotInput) => requestSlot(deps.gate, input),
    pollOnce: (input) => pollOnce(pollDeps, input),
    pausePollSchedule: (input) => pausePollSchedule(pollDeps, input),
    resumePollSchedule: (input) => resumePollSchedule(pollDeps, input),
    sweepOutbox: () => sweepOutbox({ db: deps.db, starter: deps.starter }),
    reconcile: async (): Promise<void> => {
      await reconcile({
        db: deps.db,
        kube: deps.kube,
        temporal: deps.temporal,
        setupTest: {
          ttlSeconds: deps.config.SETUP_TEST_TTL_SECONDS,
          setupTimeoutSeconds: deps.config.RUN_SETUP_TIMEOUT_SECONDS,
        },
        clock: deps.clock,
        ...(deps.log ? { log: deps.log } : {}),
      });
    },
  };
}
