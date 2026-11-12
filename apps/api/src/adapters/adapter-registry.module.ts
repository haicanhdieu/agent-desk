import { Global, Module } from '@nestjs/common';
import { createAdapterRegistry, systemClock, type AdapterRegistry } from '@agentdesk/core';
import { CONFIG, type Config } from '../config/config.module';

export const ADAPTER_REGISTRY = Symbol('ADAPTER_REGISTRY');

@Global()
@Module({
  providers: [
    {
      provide: ADAPTER_REGISTRY,
      inject: [CONFIG],
      useFactory: (config: Config): AdapterRegistry => createAdapterRegistry(config, systemClock),
    },
  ],
  exports: [ADAPTER_REGISTRY],
})
export class AdapterRegistryModule {}
