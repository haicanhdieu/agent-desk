/**
 * Deny by default: the only better-auth endpoints answered over HTTP, relative to `/auth`. better-auth's other
 * endpoints (the organization plugin's list-members and get-full-organization, update-user, list-sessions, ...) either
 * bypass the RBAC routes' permission checks or have no use in the web. A new better-auth endpoint stays unreachable
 * until it is added here. Dev-login is its own controller and never goes through this list.
 */
export const ALLOWED_AUTH_PATHS: readonly string[] = [
  '/get-session',
  '/sign-in/social',
  '/callback/*',
  '/sign-out',
  '/organization/list',
  '/organization/set-active',
  '/ok',
  '/error',
];

const PREFIX = '/auth';
const EXACT = new Set(ALLOWED_AUTH_PATHS.filter((p) => !p.endsWith('/*')));
const ONE_SEGMENT_PREFIXES = ALLOWED_AUTH_PATHS.filter((p) => p.endsWith('/*')).map((p) => p.slice(0, -1));

/**
 * True when `pathname` (full path including `/auth`, lowercased, slashes collapsed, trailing slash removed, dot
 * segments resolved, as auth.controller computes it) is not on the allow-list and must answer 404 before
 * better-auth sees it. `/callback/*` matches exactly one non-empty segment after `/callback/`.
 */
export function isBlockedAuthPath(pathname: string): boolean {
  if (!pathname.startsWith(`${PREFIX}/`)) return true;
  const rest = pathname.slice(PREFIX.length);
  if (EXACT.has(rest)) return false;
  for (const prefix of ONE_SEGMENT_PREFIXES) {
    if (rest.startsWith(prefix)) {
      const segment = rest.slice(prefix.length);
      if (segment !== '' && !segment.includes('/')) return false;
    }
  }
  return true;
}
