/**
 * OpenTelemetry for the API. Imported first by main.ts. Tracing is on only when OTEL_EXPORTER_OTLP_ENDPOINT is set:
 * then spans go to `<endpoint>/v1/traces` (OTLP/HTTP) and the Temporal client propagates the trace context into the
 * workflows it starts and signals. Unset (the default), nothing is registered: the OTel API stays a no-op.
 * Setup failures never stop the API from starting; they are logged and tracing stays off.
 */
import { trace } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { WorkflowClientInterceptor } from '@temporalio/client';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry-v2';

export interface ApiTracing {
  readonly enabled: boolean;
  /** Temporal client interceptors (empty when tracing is off). */
  readonly workflowInterceptors: WorkflowClientInterceptor[];
  shutdown(): Promise<void>;
}

const SHUTDOWN_TIMEOUT_MS = 2_000;
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms).unref());

const DISABLED: ApiTracing = { enabled: false, workflowInterceptors: [], shutdown: async () => undefined };

/** OTLP/HTTP traces URL from the standard env vars, or null when tracing is off. */
export function tracesUrl(env: NodeJS.ProcessEnv): string | null {
  const signal = env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']?.trim();
  if (signal) return signal;
  const base = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  return base ? `${base.replace(/\/+$/, '')}/v1/traces` : null;
}

export function initTracing(env: NodeJS.ProcessEnv = process.env): ApiTracing {
  const url = tracesUrl(env);
  if (url === null) return DISABLED;
  try {
    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({ 'service.name': env['OTEL_SERVICE_NAME']?.trim() || 'agentdesk-api' }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url }))],
    });
    provider.register();
    return {
      enabled: true,
      workflowInterceptors: [new OpenTelemetryWorkflowClientInterceptor()],
      shutdown: async () => {
        // Flush what is buffered, but never hold up process exit for an unreachable collector (it retries).
        await Promise.race([provider.shutdown().catch(() => undefined), delay(SHUTDOWN_TIMEOUT_MS)]);
        trace.disable();
      },
    };
  } catch (err) {
    console.warn('api: tracing disabled, setup failed:', err instanceof Error ? err.message : String(err));
    return DISABLED;
  }
}

export const tracing: ApiTracing = initTracing();
