import type { ProjectConnectionDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';

/** How often to look for the poll's result, and how long to wait for it before giving up. */
export const CHECK_NOW_INTERVAL_MS = 1000;
export const CHECK_NOW_TIMEOUT_MS = 20_000;

/** The poll was started but its result did not show up in time. */
export class CheckNowTimeout extends Error {
  constructor() {
    super('No result yet');
    this.name = 'CheckNowTimeout';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The poll runs on the worker, so its result is only visible in the connection status. Every finished poll (success
 * or failure) moves `lastCheckedAt`: fetch until it differs from `before`, and return that connection.
 */
export async function waitForPoll(
  fetchConnection: () => Promise<ProjectConnectionDto>,
  before: string | null,
  { intervalMs = CHECK_NOW_INTERVAL_MS, timeoutMs = CHECK_NOW_TIMEOUT_MS } = {},
): Promise<ProjectConnectionDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const connection = await fetchConnection();
    if ((connection.polling?.lastCheckedAt ?? null) !== before) return connection;
    if (Date.now() + intervalMs > deadline) throw new CheckNowTimeout();
    await sleep(intervalMs);
  }
}

/** What to tell the user when Check now fails: the server's reason for a refusal, else a retry hint. */
export function checkNowMessage(e: unknown): string {
  if (e instanceof CheckNowTimeout)
    return 'No result yet. The check may still be running; the status updates when it finishes.';
  if (e instanceof ApiError && e.status < 500 && e.detail !== undefined) return e.detail;
  const id = e instanceof ApiError && e.requestId !== undefined ? ` Request id: ${e.requestId}.` : '';
  return `Could not start the check. Try again in a moment.${id}`;
}

/** After a finished poll: why it failed, or undefined when it went through. */
export function failedPollMessage(connection: ProjectConnectionDto): string | undefined {
  const error = connection.polling?.lastError;
  return error ? `The check ran but failed: ${error}. Agent Desk keeps trying on its own.` : undefined;
}
