import { Global, Logger, Module } from '@nestjs/common';
import { createAdapterRegistry, systemClock, type AdapterRegistry } from '@agentdesk/core';
import { CONFIG, type Config } from '../config/config.module';

export const ADAPTER_REGISTRY = Symbol('ADAPTER_REGISTRY');

function boardLog(): { warn(fields: { err: string }, msg: string): void } {
  const logger = new Logger('BoardAdapter');
  return { warn: (f, m) => logger.warn(`${m} ${JSON.stringify(f)}`) };
}

@Global()
@Module({
  providers: [
    {
      provide: ADAPTER_REGISTRY,
      inject: [CONFIG],
      useFactory: (config: Config): AdapterRegistry => createAdapterRegistry(config, systemClock, { log: boardLog() }),
    },
  ],
  exports: [ADAPTER_REGISTRY],
})
export class AdapterRegistryModule {}
