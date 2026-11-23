import { ORG_SUSPENDED_PROBLEM_TYPE } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';

// A member of a suspended org is refused 403 `org-suspended` on every org route (spec BR-37, BR-38). A page that is
// already open learns it from any failing query or mutation: the org's cached data is dropped (nothing of it may stay
// on screen) and the router reloads, which lands on the suspended message.

/** True for the 403 problem the API answers when the caller's org is suspended. */
export function isOrgSuspendedError(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 403 &&
    (e.type === ORG_SUSPENDED_PROBLEM_TYPE || e.type.endsWith(`:${ORG_SUSPENDED_PROBLEM_TYPE}`))
  );
}

let router: AnyRouter | undefined;
/** The org already handled: the reload re-fetches and is refused again, which must not start another reload. */
let handled: string | undefined;

/** The app router; `createAppRouter` registers it so the global handler can reload it. */
export function registerOrgSuspendedRouter(next: AnyRouter): void {
  router = next;
  handled = undefined;
}

const ORG_PATH = /^\/o\/([^/]+)/;

function onScreenSlug(): string | undefined {
  const raw = router ? ORG_PATH.exec(router.latestLocation.pathname)?.[1] : undefined;
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/**
 * The global query and mutation error handler: on `org-suspended`, drop the org's cached data and reload the route.
 * The org is the failing query's (`['org', slug, ...]`); a mutation carries none, so the org on screen stands in. A
 * late refusal for an org that is no longer on screen only drops that org's data: the page shown is healthy.
 */
export function handleOrgSuspended(queryClient: QueryClient, error: unknown, queryKey?: readonly unknown[]): void {
  if (!isOrgSuspendedError(error)) return;
  const shown = onScreenSlug();
  const keyed = queryKey?.[0] === 'org' && typeof queryKey[1] === 'string' ? queryKey[1] : undefined;
  const slug = keyed ?? shown;
  if (keyed !== undefined && keyed !== shown) {
    queryClient.removeQueries({ queryKey: ['org', keyed] });
    return;
  }
  const key = slug ?? '';
  if (handled === key) return;
  handled = key;
  queryClient.removeQueries({ queryKey: slug === undefined ? ['org'] : ['org', slug] });
  void router?.invalidate();
}

/** A query of the org answered: it is not suspended (any more), so the next refusal is news again. */
export function noteOrgAnswered(queryKey: readonly unknown[]): void {
  if (handled !== undefined && queryKey[0] === 'org' && (handled === '' || queryKey[1] === handled))
    handled = undefined;
}
