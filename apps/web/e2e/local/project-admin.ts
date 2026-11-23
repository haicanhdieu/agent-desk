import { randomBytes } from 'node:crypto';
import type { APIResponse } from '@playwright/test';
import { inviteAndSignIn, type GrantScope, type RoleKey } from './helpers';
import type { Actor, Cast } from './rbac-cast';

// Shared helpers of the project admin space local specs (rbac-project-admin*.spec.ts): the project members and project
// audit routes as one person, an extra org member, and the Settings page URLs.

const members = (projectId: string): string => `/api/projects/${projectId}/members`;

/** The four project member routes, called as `who` (their browser context's cookie). */
export function projectMembersApi(
  who: Pick<Actor, 'api'>,
  projectId: string,
): {
  list(): Promise<APIResponse>;
  add(userId: string, roleId: string): Promise<APIResponse>;
  setRole(userId: string, roleId: string): Promise<APIResponse>;
  remove(userId: string): Promise<APIResponse>;
} {
  return {
    list: () => who.api.get(`${members(projectId)}?pageSize=100`),
    add: (userId, roleId) => who.api.post(members(projectId), { data: { userId, roleId } }),
    setRole: (userId, roleId) => who.api.put(`${members(projectId)}/${userId}/role`, { data: { roleId } }),
    remove: (userId) => who.api.delete(`${members(projectId)}/${userId}`),
  };
}

/** The project's audit log (first 100 entries), read as `who`. */
export function projectAuditApi(who: Pick<Actor, 'api'>, projectId: string): Promise<APIResponse> {
  return who.api.get(`/api/projects/${projectId}/audit?pageSize=100`);
}

/**
 * A new org member with an `e2e-<rand>` handle, invited with `roleKey` over `scope` and signed in in its own browser
 * context. The caller closes `ctx` (in a `finally`).
 */
export async function freshOrgMember(cast: Cast, roleKey: RoleKey, scope: GrantScope): Promise<Actor> {
  const browser = cast.o.ctx.browser();
  if (!browser) throw new Error('the cast browser is gone');
  const handle = `e2e-${randomBytes(4).toString('hex')}`;
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const invite =
      scope.type === 'org' ? { type: 'org' as const } : { type: 'project' as const, projectIds: [scope.projectId] };
    const { userId } = await inviteAndSignIn(page, cast.pa, cast.orgId, handle, roleKey, invite);
    await page.goto('/api/me/access');
    return { handle, userId, ctx, page, api: ctx.request };
  } catch (error) {
    await ctx.close().catch(() => null);
    throw error;
  }
}

/** P's Settings → Members page. */
export const membersUrl = (cast: Pick<Cast, 'slug'>, projectId: string): string =>
  `/o/${cast.slug}/p/${projectId}/desk/members`;

/** P's Settings → Audit log page. */
export const auditUrl = (cast: Pick<Cast, 'slug'>, projectId: string): string =>
  `/o/${cast.slug}/p/${projectId}/desk/audit`;
