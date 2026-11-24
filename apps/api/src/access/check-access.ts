import { and, eq } from 'drizzle-orm';
import type { Access, Permission, RouteAccess } from '@agentdesk/contracts';
import { loadAccess, type AccessLog } from '@agentdesk/core';
import { member, organization, withOrg, type Db } from '@agentdesk/db';
import { preTargetDecision, targetDecision } from './authorize';
import { resolveTarget, type ResolvedTarget } from './target-resolver';

export type AccessCheck =
  | { ok: true; access: Access; target?: ResolvedTarget }
  | { ok: false; status: 403 | 404; reason: string; permission?: Permission; projectId?: string };

/**
 * Whether the user is a member of the org and, if so, whether the org is suspended: one query, member joined to
 * organization. 'none' for a non-member (an org's status is never read for someone who is not in it). Every tenant
 * check starts here.
 */
export async function orgMembership(
  db: Db,
  who: { userId: string; orgId: string },
): Promise<'none' | 'active' | 'suspended'> {
  const rows = await db.orm
    .select({ status: organization.status })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.organizationId, who.orgId), eq(member.userId, who.userId)))
    .limit(1);
  const row = rows[0];
  if (!row) return 'none';
  return row.status === 'suspended' ? 'suspended' : 'active';
}

/** The one permission a route entry names, when it names exactly one. */
function permissionOf(entry: RouteAccess): Permission | undefined {
  return 'permission' in entry ? entry.permission : undefined;
}

/**
 * The tenant access decision for one request, shared by the HTTP guard and (later) the terminal and install callback:
 * membership of the active org (else the plain 403 `not-a-member`), then the org being active (a suspended org refuses
 * every member, whatever the role, with 403 `org-suspended`; a non-member never learns of it), a path `:orgId` that is not the active org (404), the caller's grants loaded
 * under `withOrg`, the permission held somewhere in the org (else 403, before any id is looked up, so a missing, foreign
 * or malformed target gets the same answer as a real one), then for project routes the target's project and owner in one
 * lookup: missing, other org or outside the caller's scopes is 404, visible but not allowed is 403. Fails closed: a
 * platform entry never reaches here and is refused.
 */
export async function checkTenantAccess(
  db: Db,
  who: { userId: string; orgId: string },
  entry: RouteAccess,
  params: Record<string, string | undefined>,
  log?: AccessLog,
): Promise<AccessCheck> {
  const membership = await orgMembership(db, who);
  if (membership === 'none') return { ok: false, status: 403, reason: 'not-a-member' };
  if (membership === 'suspended') return { ok: false, status: 403, reason: 'org-suspended' };
  if (params['orgId'] !== undefined && params['orgId'] !== who.orgId) {
    return { ok: false, status: 404, reason: 'org-not-active' };
  }
  if (entry.scope === 'platform') return { ok: false, status: 403, reason: 'platform-route' };
  if (entry.scope === 'user') return { ok: false, status: 403, reason: 'user-route' };
  const permission = permissionOf(entry);
  const refused = (status: 403 | 404, reason: string, projectId?: string): AccessCheck => ({
    ok: false,
    status,
    reason,
    ...(permission === undefined ? {} : { permission }),
    ...(projectId === undefined ? {} : { projectId }),
  });

  return withOrg(db, who.orgId, async (tx): Promise<AccessCheck> => {
    const access = await loadAccess(tx, who.userId, log);
    const pre = preTargetDecision(entry, access);
    if (pre === 'forbidden') return refused(403, 'permission');
    if (pre === 'allow' || entry.scope !== 'project') return { ok: true, access };

    const target = await resolveTarget(tx, entry.param, params[entry.param]);
    const decision = targetDecision(entry, access, target);
    if (decision === 'not-found' || target === null) return refused(404, 'target-not-found');
    if (decision === 'forbidden') return refused(403, 'permission-on-target', target.projectId);
    return { ok: true, access, target };
  });
}
