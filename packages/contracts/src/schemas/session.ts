import { FINAL_RUN_STATUSES, type RunStatus } from '../enums';

interface KeptSessionFields {
  sessionExpiresAt: string | null;
}

/** A session is kept while `sessionExpiresAt` is set and in the future (ADR 0022). */
export function hasKeptSession(run: KeptSessionFields, now: Date): boolean {
  return run.sessionExpiresAt !== null && new Date(run.sessionExpiresAt).getTime() > now.getTime();
}

/** Live statuses in which the idle timer can be ending the session (the status stays `idle`/`running`/`done`). */
const ENDING_RUN_STATUSES = ['idle', 'running', 'done'] as const satisfies readonly RunStatus[];

/**
 * A person may resume a paused run, re-open a succeeded run whose session is still kept, or ask for a resume while the
 * idle timer is ending the session (`sessionEndingAt` set): the workflow runs it right after the park.
 */
export function canResume(
  run: KeptSessionFields & { status: RunStatus; sessionEndingAt: string | null },
  now: Date,
): boolean {
  if (run.status === 'paused') return true;
  if (run.status === 'succeeded') return hasKeptSession(run, now);
  return run.sessionEndingAt !== null && (ENDING_RUN_STATUSES as readonly RunStatus[]).includes(run.status);
}

/** Final and no kept session: the run can never change again. */
export function isSettled(run: KeptSessionFields & { status: RunStatus }, now: Date): boolean {
  const final = (FINAL_RUN_STATUSES as readonly RunStatus[]).includes(run.status);
  return final && !hasKeptSession(run, now);
}
