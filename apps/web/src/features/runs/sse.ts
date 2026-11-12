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
