import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import {
  createAdapterRegistry,
  createKubeGateway,
  createSecretStore,
  parseConfig,
  systemClock,
  type AdapterRegistry,
  type Config,
  type KubeGateway,
  type SecretStore,
} from '@agentdesk/core';
import { createDb, type Db } from '@agentdesk/db';

export const CONFIG = Symbol('CONFIG');
export const DB = Symbol('DB');
export const ADAPTERS = Symbol('ADAPTERS');
export const SECRET_STORE = Symbol('SECRET_STORE');
export const KUBE = Symbol('KUBE');

function boardLog(): { warn(fields: { err: string }, msg: string): void } {
  const logger = new Logger('BoardAdapter');
  return { warn: (f, m) => logger.warn(`${m} ${JSON.stringify(f)}`) };
}

/** Providers the activities need. Explicit tokens and factories: tsx emits no decorator metadata. */
@Module({
  providers: [
    { provide: CONFIG, useFactory: (): Config => parseConfig(process.env) },
    { provide: DB, inject: [CONFIG], useFactory: (c: Config): Db => createDb(c.DATABASE_APP_URL) },
    {
      provide: ADAPTERS,
      inject: [CONFIG],
      useFactory: (c: Config): AdapterRegistry => createAdapterRegistry(c, systemClock, { log: boardLog() }),
    },
    { provide: SECRET_STORE, inject: [CONFIG], useFactory: (c: Config): SecretStore => createSecretStore(c) },
    { provide: KUBE, inject: [CONFIG], useFactory: (c: Config): KubeGateway => createKubeGateway(c) },
  ],
  exports: [CONFIG, DB, ADAPTERS, SECRET_STORE, KUBE],
})
export class WorkerModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}
