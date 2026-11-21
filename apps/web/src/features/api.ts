import { createApi } from '@agentdesk/contracts/client';
import { resyncOnMismatch, urlOrgId } from './auth/orgResync';
import { signOutAndRedirect } from './auth/signOut';

/**
 * The app's contracts client. The default `api` export of `@agentdesk/contracts/client` takes no options after
 * creation, so the app builds its own with every 401 routed to the once-guarded sign-out path and every request
 * pinned to the URL org. Import this one, not the default.
 */
export const api = createApi({
  onUnauthorized: () => void signOutAndRedirect(),
  // Every request is pinned to the org in the URL; a 409 org-mismatch resyncs the tab (see auth/orgResync.ts).
  orgId: urlOrgId,
  onOrgMismatch: resyncOnMismatch,
});
