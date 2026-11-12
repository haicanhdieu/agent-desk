import type { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { authClient } from './client';
import { safeRedirect } from './redirect';

// The sign-out path for an expired session (spec §4.4, §6): any 401 lands here. It runs once until the next
// successful session fetch, so a burst of 401s from parallel queries signs out and navigates exactly once.

interface SignOutTarget {
  router: AnyRouter;
  queryClient: QueryClient;
}

let target: SignOutTarget | undefined;
let signingOut = false;

/** The app router and its QueryClient; `createAppRouter` registers them (tests register each fresh pair). */
export function registerSignOutTarget(next: SignOutTarget): void {
  target = next;
}

/** Re-arms the sign-out path; called after a session fetch returns a signed-in user. */
export function resetSignOutGuard(): void {
  signingOut = false;
}

/**
 * Signs out (best effort: the session may already be gone), clears every cached query and navigates to
 * `/sign-in?redirect=<current location>`. Calls after the first are ignored until `resetSignOutGuard()`.
 */
export async function signOutAndRedirect(redirect?: string): Promise<void> {
  if (signingOut || !target) return;
  signingOut = true;
  const { router, queryClient } = target;
  const current = redirect ?? router.state.location.href;
  const back = router.state.location.pathname === '/sign-in' ? undefined : safeRedirect(current);
  try {
    await authClient.signOut();
  } catch {
    // Network failure: the cookie is still cleared server-side on expiry; carry on to the sign-in page.
  }
  queryClient.clear();
  await router.navigate({ to: '/sign-in', search: back === undefined ? {} : { redirect: back } });
}
