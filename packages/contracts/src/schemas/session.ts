import { FINAL_RUN_STATUSES, type RunStatus } from '../enums';

interface KeptSessionFields {
  sessionExpiresAt: string | null;
}

/** A session is kept while `sessionExpiresAt` is set and in the future (ADR 0022). */
export function hasKeptSession(run: KeptSessionFields, now: Date): boolean {
  return run.sessionExpiresAt !== null && new Date(run.sessionExpiresAt).getTime() > now.getTime();
}

/** A person may resume a paused run, or re-open a succeeded run whose session is still kept. */
export function canResume(run: KeptSessionFields & { status: RunStatus }, now: Date): boolean {
  if (run.status === 'paused') return true;
  return run.status === 'succeeded' && hasKeptSession(run, now);
}

/** Final and no kept session: the run can never change again. */
export function isSettled(run: KeptSessionFields & { status: RunStatus }, now: Date): boolean {
  const final = (FINAL_RUN_STATUSES as readonly RunStatus[]).includes(run.status);
  return final && !hasKeptSession(run, now);
}
