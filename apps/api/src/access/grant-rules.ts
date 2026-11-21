import { PERMISSION_LEVEL, can, type Access, type GrantLine, type Scope, type ScopeType } from '@agentdesk/contracts';

export interface RoleForGrant {
  id: string;
  key: string;
  name: string;
  builtIn: boolean;
  assignableScopes: ScopeType[];
  lines: GrantLine[];
}

export type GrantCheck = { ok: true } | { ok: false; reason: 'no-right' | 'escalation' | 'owner-only' };

/** An org-scope grant with roleKey 'owner'. */
export function isOrgOwner(access: Access): boolean {
  return access.grants.some((g) => g.scope.type === 'org' && g.roleKey === 'owner');
}

/**
 * Tenant rules: the actor holds `permission` at `scope`; the owner role is assigned only by an org owner; every line of
 * `role` that takes effect at `scope` is held by the actor at `scope` (an `own` line is covered by `own` or `any`).
 * Org-level lines take effect only at org scope; platform lines never take effect, so they are never covered.
 */
export function checkTenantAssign(
  access: Access,
  permission: 'assignment:create' | 'assignment:delete',
  role: RoleForGrant,
  scope: Scope,
): GrantCheck {
  const target = scope.type === 'project' ? { projectId: scope.projectId } : {};
  if (!can(access, permission, target)) return { ok: false, reason: 'no-right' };
  if (role.key === 'owner' && !isOrgOwner(access)) return { ok: false, reason: 'owner-only' };
  const covered = role.lines.every((l) => {
    if (scope.type === 'project' && PERMISSION_LEVEL[l.permission] === 'org') return true;
    return can(access, l.permission, {
      ...target,
      ownerUserId: l.condition === 'own' ? access.userId : undefined,
    });
  });
  return covered ? { ok: true } : { ok: false, reason: 'escalation' };
}
