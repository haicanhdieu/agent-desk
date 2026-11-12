import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Client } from '@temporalio/client';
import type { Db } from '@agentdesk/db';
import { DB } from '../db/db.module';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';

const CHECK_TIMEOUT_MS = 2000;

/** Rejects if `work` does not settle in time, so a dead dependency cannot hang the probe. */
function within<T>(work: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
    work.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e: unknown) => (clearTimeout(timer), reject(e instanceof Error ? e : new Error('check failed'))),
    );
  });
}

@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  @Get('healthz')
  healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readyz(): Promise<{ status: 'ok' }> {
    const failed: string[] = [];
    await Promise.all([
      within(this.db.pool.query('select 1')).catch(() => failed.push('postgres')),
      within(this.temporal.workflowService.getSystemInfo({})).catch(() => failed.push('temporal')),
    ]);
    if (failed.length > 0) throw new ServiceUnavailableException(`not ready: ${failed.join(', ')}`);
    return { status: 'ok' };
  }
}
