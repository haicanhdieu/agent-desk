import { Global, Module } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { CONFIG, type Config } from '../config/config.module';

export const TEMPORAL_CLIENT = Symbol('TEMPORAL_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: TEMPORAL_CLIENT,
      inject: [CONFIG],
      // lazy: the API boots without Temporal; /readyz reports its availability.
      useFactory: (config: Config): Client =>
        new Client({
          connection: Connection.lazy({ address: config.TEMPORAL_ADDRESS }),
          namespace: config.TEMPORAL_NAMESPACE,
        }),
    },
  ],
  exports: [TEMPORAL_CLIENT],
})
export class TemporalClientModule {}
