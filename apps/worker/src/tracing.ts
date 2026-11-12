/**
 * OpenTelemetry for the worker. Imported first by main.ts. Tracing is on only when OTEL_EXPORTER_OTLP_ENDPOINT is set:
 * then spans go to `<endpoint>/v1/traces` (OTLP/HTTP), and the Temporal OpenTelemetryPlugin (client, workflow and
 * activity interceptors plus the workflow span sink) is passed to the Client and the Worker. Unset (the default),
 * nothing is registered and `plugins` is empty: the OTel API stays a no-op and workflow bundles are unchanged.
 * Setup failures never stop the worker from starting; they are logged and tracing stays off.
 */
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { OpenTelemetryPlugin } from '@temporalio/interceptors-opentelemetry-v2';

export interface WorkerTracing {
  readonly enabled: boolean;
  /** Pass to both `new Client({ plugins })` and `Worker.create({ plugins })` (empty when tracing is off). */
  readonly plugins: OpenTelemetryPlugin[];
  shutdown(): Promise<void>;
}

const SHUTDOWN_TIMEOUT_MS = 2_000;
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms).unref());

const DISABLED: WorkerTracing = { enabled: false, plugins: [], shutdown: async () => undefined };

/** OTLP/HTTP traces URL from the standard env vars, or null when tracing is off. */
export function tracesUrl(env: NodeJS.ProcessEnv): string | null {
  const signal = env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']?.trim();
  if (signal) return signal;
  const base = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  return base ? `${base.replace(/\/+$/, '')}/v1/traces` : null;
}

export function initTracing(env: NodeJS.ProcessEnv = process.env): WorkerTracing {
  const url = tracesUrl(env);
  if (url === null) return DISABLED;
  try {
    const resource = resourceFromAttributes({
      'service.name': env['OTEL_SERVICE_NAME']?.trim() || 'agentdesk-worker',
    });
    const spanProcessor = new BatchSpanProcessor(new OTLPTraceExporter({ url }));
    const provider = new NodeTracerProvider({ resource, spanProcessors: [spanProcessor] });
    provider.register();
    return {
      enabled: true,
      // Workflow spans are created in the sandbox and exported through a sink into the same span processor.
      plugins: [new OpenTelemetryPlugin({ resource, spanProcessor })],
      shutdown: async () => {
        // Flush what is buffered, but never hold up process exit for an unreachable collector (it retries).
        await Promise.race([provider.shutdown().catch(() => undefined), delay(SHUTDOWN_TIMEOUT_MS)]);
        trace.disable();
      },
    };
  } catch (err) {
    console.warn('worker: tracing disabled, setup failed:', err instanceof Error ? err.message : String(err));
    return DISABLED;
  }
}

export const tracing: WorkerTracing = initTracing();
