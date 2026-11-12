import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Client } from '@temporalio/client';
import type { Db } from '@agentdesk/db';
import {
  processTicketEvent,
  startRunWorkflow,
  systemClock,
  type AdapterRegistry,
  type IntakeChannel,
  type IntakeDeps,
  type IntakeResult,
  type TicketEvent,
} from '@agentdesk/core';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';

/** The shared intake pipeline (webhook and dev routes) wired to this process's database, adapters and Temporal. */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);
  private readonly deps: IntakeDeps;

  constructor(
    @Inject(DB) db: Db,
    @Inject(ADAPTER_REGISTRY) registry: AdapterRegistry,
    @Inject(TEMPORAL_CLIENT) temporal: Client,
    @Inject(CONFIG) config: Config,
  ) {
    const log = { warn: (obj: object, msg: string) => this.logger.warn(`${msg} ${JSON.stringify(obj)}`) };
    this.deps = {
      db,
      registry,
      clock: systemClock,
      botLogin: config.BOT_NAME,
      log,
      startRun: async (orgId, runId) => void (await startRunWorkflow(temporal.workflow, db, orgId, runId, log)),
    };
  }

  process(event: TicketEvent, channel: IntakeChannel): Promise<IntakeResult> {
    return processTicketEvent(this.deps, event, channel);
  }
}
