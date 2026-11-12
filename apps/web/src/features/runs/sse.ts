import type { z } from 'zod';

/**
 * A server-sent message's JSON payload parsed with `schema`; anything else (not a message, not JSON, not the shape)
 * is `undefined` and the caller drops it.
 */
export function parseMessage<S extends z.ZodType>(schema: S, ev: Event): z.output<S> | undefined {
  if (!(ev instanceof MessageEvent)) return undefined;
  const raw: unknown = ev.data;
  if (typeof raw !== 'string') return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** Back-off before re-opening a stream the browser gave up on (CLOSED): 1, 2, 4, 8, 16, then 30 s. */
export const STREAM_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
/** Consecutive failed re-opens after which a hook stops; REST refetches (focus, navigation) take over. */
export const STREAM_MAX_ATTEMPTS = 8;
/** Up to this share is added at random to each delay so many tabs do not retry in step. */
export const STREAM_RETRY_JITTER = 0.2;

/** The delay before re-open attempt `attempt` (0-based), with jitter. */
export function streamRetryDelay(attempt: number, random: () => number = Math.random): number {
  const base = STREAM_RETRY_DELAYS_MS[Math.min(attempt, STREAM_RETRY_DELAYS_MS.length - 1)] ?? 30_000;
  return Math.round(base * (1 + STREAM_RETRY_JITTER * random()));
}
