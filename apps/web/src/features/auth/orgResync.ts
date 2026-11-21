import { isOrgMismatchError } from '@agentdesk/contracts/client';
import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { orgsQuery, sessionQuery, setActiveOrganization } from './session';

// Per-request org pinning (spec §Two tabs, BR-11): every request names the org in the URL. When the session's active
// org was switched in another tab the API answers 409 `org-mismatch`; the tab then makes its URL org active again,
// drops the org cache and reloads. Like the 401 handler in signOut.ts, the target is registered by the router factory
// and only one resync runs at a time.

export const ORG_SWITCHED_MESSAGE = 'This organization was switched in another tab. Try again.';

interface ResyncTarget {
  router: AnyRouter;
  queryClient: QueryClient;
}

let target: ResyncTarget | undefined;
let inFlight: Promise<void> | undefined;
/** How long after a mismatch resync another mismatch counts as a real error (a route that keeps answering 409), not a stale tab. */
export const RESYNC_LOOP_BOUND_MS = 5_000;
/** When the last mismatch resync started and, once it settled, finished. */
let lastResyncAt = Number.NEGATIVE_INFINITY;

/** The app router and its QueryClient; `createAppRouter` registers them (tests register each fresh pair). */
export function registerOrgResyncTarget(next: ResyncTarget): void {
  target = next;
  inFlight = undefined;
  lastResyncAt = Number.NEGATIVE_INFINITY;
}

const ORG_PATH = /^\/o\/([^/]+)/;

/**
 * The id of the org in the URL being shown or loaded (`/o/$org/...`, the slug looked up in the user's orgs), or
 * undefined outside an org route or for an unknown slug. Reads the latest location, not the settled matches, so the
 * loaders of a navigation already send the org they navigate to.
 */
export function urlOrgId(): string | undefined {
  if (!target) return undefined;
  const slug = ORG_PATH.exec(target.router.latestLocation.pathname)?.[1];
  if (slug === undefined) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return undefined; // a malformed % escape names no org: send no header
  }
  return target.queryClient.getQueryData(orgsQuery.queryKey)?.find((o) => o.slug === decoded)?.id;
}

async function run(): Promise<void> {
  if (!target) return;
  const { router, queryClient } = target;
  const id = urlOrgId();
  const org = queryClient.getQueryData(orgsQuery.queryKey)?.find((o) => o.id === id);
  if (!org) return;
  await setActiveOrganization(queryClient, org);
  // Not awaited: this runs inside a request a loader may be awaiting, and the reload waits for those loaders.
  void router.invalidate();
}

/**
 * Makes the URL org the session's active org, drops the `['org']` cache and reloads the route data. One at a time:
 * calls made while one is running share it. A failure is swallowed (the caller shows its own error).
 */
export function resyncOrg(): Promise<void> {
  inFlight ??= run()
    .catch(() => undefined)
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

/**
 * For a stream that failed (an EventSource cannot see the 409): resyncs only when the server's session org is not the
 * URL org, so a network blip costs one session read. It does not touch the loop bound of `resyncOnMismatch`.
 */
export async function resyncOrgAfterStreamError(): Promise<void> {
  if (inFlight) return inFlight;
  if (!target) return;
  const id = urlOrgId();
  const session = await target.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 }).catch(() => undefined);
  if (id === undefined || !session || session.activeOrganizationId === id) return;
  return resyncOrg();
}

/** The API client's `onOrgMismatch`: resyncs, unless one just ran and did not help (no loop; a later mismatch resyncs again). */
export function resyncOnMismatch(): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - lastResyncAt < RESYNC_LOOP_BOUND_MS) return Promise.resolve();
  // Stamped before the resync runs and again when it settles, so the bound covers the reloaded requests.
  lastResyncAt = Date.now();
  const resync = resyncOrg();
  void resync.then(() => {
    lastResyncAt = Date.now();
  });
  return resync;
}

export const isOrgMismatch = isOrgMismatchError;
