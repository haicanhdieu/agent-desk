import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  orgId?: string;
  runId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run: <T>(ctx: RequestContext, fn: () => T): T => storage.run(ctx, fn),
  get: (): RequestContext | undefined => storage.getStore(),
  /** Later layers (auth, run routes) add orgId/runId so every log line after that carries them. */
  set: (patch: Partial<Omit<RequestContext, 'requestId'>>): void => {
    const ctx = storage.getStore();
    if (ctx) Object.assign(ctx, patch);
  },
};

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Accepts a caller-supplied id only if it is short and header/log-safe; otherwise a fresh one is used. */
export function pickRequestId(incoming: string | string[] | undefined, generate: () => string): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate !== undefined && SAFE_ID.test(candidate) ? candidate : generate();
}
