import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { CONFIG, type Config } from '../config/config.module';
import { tracing } from '../tracing';

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
          // OTel trace propagation into workflows; empty unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
          interceptors: { workflow: tracing.workflowInterceptors },
        }),
    },
  ],
  exports: [TEMPORAL_CLIENT],
})
export class TemporalClientModule implements OnApplicationShutdown {
  /** Flushes buffered spans when the app closes (no-op when tracing is off). */
  async onApplicationShutdown(): Promise<void> {
    await tracing.shutdown();
  }
}
