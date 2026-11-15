/**
 * Pure helpers for the workspace-token refresh loop (ADR 0021). No I/O and no clock: the workflow and the activities
 * both import this, so it must stay deterministic.
 */

/** Used when the activity gave no delay (a result from before the field existed, or a token without an expiry). */
export const TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT = 2700;
/** A refresh that failed after the activity's own retries is tried again this often, then more slowly. */
export const TOKEN_REFRESH_RETRY_SECONDS = 60;
export const TOKEN_REFRESH_RETRY_SLOW_SECONDS = 300;
/** Quick retries last about 15 minutes (the margin); after that the slow rate keeps the history small over days. */
export const TOKEN_REFRESH_QUICK_RETRIES = 15;
/** The next refresh is due after this share of the token's remaining life. */
export const TOKEN_REFRESH_LIFETIME_SHARE = 0.75;
/** However short the token's remaining life, never refresh more often than this. */
export const TOKEN_REFRESH_MIN_SECONDS = 60;

/** What the activities that mint a token report back: when to refresh next. The token itself never leaves them. */
export interface TokenRefreshPlan {
  nextRefreshSeconds?: number;
}

/** About 75% of the time left until `expiresAt`, whole seconds, at least 60. */
export function nextRefreshDelaySeconds(expiresAt: Date, now: Date): number {
  const leftSeconds = (expiresAt.getTime() - now.getTime()) / 1000;
  const delay = Math.floor(leftSeconds * TOKEN_REFRESH_LIFETIME_SHARE);
  return Number.isFinite(delay) ? Math.max(TOKEN_REFRESH_MIN_SECONDS, delay) : TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT;
}

/**
 * Seconds to wait before the next refresh attempt. After a success: the test override, else the delay the activity
 * reported, else the default. After `failures` failed attempts in a row: 60 s for the first 15, then 300 s.
 */
export function refreshWaitSeconds(input: {
  failures: number;
  overrideSeconds?: number | undefined;
  plannedSeconds?: number | undefined;
}): number {
  if (input.failures > 0) {
    return input.failures <= TOKEN_REFRESH_QUICK_RETRIES
      ? TOKEN_REFRESH_RETRY_SECONDS
      : TOKEN_REFRESH_RETRY_SLOW_SECONDS;
  }
  return input.overrideSeconds ?? input.plannedSeconds ?? TOKEN_REFRESH_INTERVAL_SECONDS_DEFAULT;
}

/** The run's history is nearly full (Temporal stops a workflow at 51,200 events): finish it while cleanup can still run. */
export const HISTORY_EVENT_LIMIT_DEFAULT = 45_000;
export const historyTooLong = (historyLength: number, limit: number | undefined): boolean =>
  historyLength >= (limit ?? HISTORY_EVENT_LIMIT_DEFAULT);
