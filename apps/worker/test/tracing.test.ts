import { trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it } from 'vitest';
import { initTracing, tracesUrl } from '../src/tracing';

afterEach(() => trace.disable());

describe('worker tracing', () => {
  it('is a no-op without OTEL_EXPORTER_OTLP_ENDPOINT (unset or empty)', async () => {
    for (const env of [{}, { OTEL_EXPORTER_OTLP_ENDPOINT: '' }, { OTEL_EXPORTER_OTLP_ENDPOINT: '  ' }]) {
      const t = initTracing(env);
      expect(t.enabled).toBe(false);
      expect(t.plugins).toEqual([]);
      await t.shutdown();
    }
    // Nothing registered: the global tracer still hands out non-recording spans.
    expect(trace.getTracer('t').startSpan('s').isRecording()).toBe(false);
  });

  it('starts with an unreachable endpoint without throwing, records spans, shuts down cleanly', async () => {
    // Port 9 (discard) on localhost: nothing listens; the export fails in the background, never at startup.
    const t = initTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9/' });
    expect(t.enabled).toBe(true);
    expect(t.plugins).toHaveLength(1);
    const span = trace.getTracer('t').startSpan('s');
    expect(span.isRecording()).toBe(true);
    span.end();
    await expect(t.shutdown()).resolves.toBeUndefined();
  });

  it('derives the traces URL from the base endpoint or the signal-specific one', () => {
    expect(tracesUrl({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318/' })).toBe('http://otel:4318/v1/traces');
    expect(tracesUrl({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://otel:4318/custom' })).toBe(
      'http://otel:4318/custom',
    );
    expect(tracesUrl({})).toBeNull();
  });
});
