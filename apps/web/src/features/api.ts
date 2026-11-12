import { createApi } from '@agentdesk/contracts/client';
import { signOutAndRedirect } from './auth/signOut';

/**
 * The app's contracts client. The default `api` export of `@agentdesk/contracts/client` takes no options after
 * creation, so the app builds its own with every 401 routed to the once-guarded sign-out path. Import this one, not
 * the default.
 */
export const api = createApi({ onUnauthorized: () => void signOutAndRedirect() });
