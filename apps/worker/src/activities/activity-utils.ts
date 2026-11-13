import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { redact } from '@agentdesk/core';

/** Shared by the run and setup-test activities (a pure move out of run.activities.impl.ts; behaviour unchanged). */

/** Secret values shorter than this are not used for redaction (they would blank out ordinary text). */
export const MIN_SECRET_LENGTH = 6;
export const ERROR_MESSAGE_MAX = 500;
/** Setup/plugin output is stored as one lifecycle event per this many lines, up to this many characters in all. */
export const SETUP_CHUNK_LINES = 50;
export const SETUP_OUTPUT_MAX_CHARS = 262_144;
/** Where the clone URL sits in a sandbox Job's Secret (the runner reads it from here). */
export const CLONE_URL_KEY = 'REPO_CLONE_URL';

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

/** Values worth redacting: each value, plus the user/password parts of URL values (the clone URL's token). */
export function secretValues(data: Record<string, string> | null | undefined): string[] {
  const out: string[] = [];
  for (const v of Object.values(data ?? {})) {
    out.push(v);
    try {
      const u = new URL(v);
      if (u.password) out.push(decodeURIComponent(u.password), u.password);
      if (u.username && u.password) out.push(decodeURIComponent(u.username));
    } catch {
      // not a URL
    }
  }
  return [...new Set(out.filter((s) => s.length >= MIN_SECRET_LENGTH))];
}

/**
 * Activity errors end up in Temporal history, `runs.failure_reason` and the finish comment: re-throw anything that is
 * not ours as an ApplicationFailure with a redacted, bounded message (the original error is dropped, not chained).
 */
export function safeError(err: unknown, secrets: string[], what: string): Error {
  if (err instanceof ApplicationFailure || err instanceof CancelledFailure) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : 'Error';
  const message = redact(raw, secrets).replace(/\s+/g, ' ').slice(0, ERROR_MESSAGE_MAX);
  return ApplicationFailure.retryable(`${what}: ${message}`, name);
}

export const oneLine = (s: string): string => s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

/**
 * Every activity body runs inside this: whatever escapes (a DB error, a store error thrown before an inner
 * `safeError`) leaves as a redacted, bounded ApplicationFailure with no cause. Inner `safeError`s, which know the
 * run's secret values, still redact first; their ApplicationFailures pass through unchanged.
 */
export const guarded =
  <A extends unknown[], R>(what: string, fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      throw safeError(err, [], what);
    }
  };
