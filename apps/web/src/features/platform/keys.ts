import type { PageQuery } from '@agentdesk/contracts';

/**
 * Query keys of the platform area. They start `['platform', …]`, outside `['org', slug]`: an org switch clears the
 * org cache and must keep these (the platform area has no org). The admin flag is `accessKeys.platform()`.
 */
export const platformKeys = {
  all: () => ['platform'] as const,
  adminsAll: () => ['platform', 'admins'] as const,
  admins: (q: PageQuery) => ['platform', 'admins', q] as const,
  orgsAll: () => ['platform', 'orgs'] as const,
  orgs: (q: object) => ['platform', 'orgs', q] as const,
  org: (orgId: string) => ['platform', 'orgs', orgId] as const,
  orgList: (orgId: string, list: 'members' | 'projects' | 'invitations', q: object) =>
    ['platform', 'orgs', orgId, list, q] as const,
  orgRoles: (orgId: string) => ['platform', 'orgs', orgId, 'roles'] as const,
  audit: (q: object) => ['platform', 'audit', q] as const,
};
