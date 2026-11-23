import { can, type Access, type MemberDto } from '@agentdesk/contracts';
import type { MemberRowView, OrgRoleKey } from '@/mocks/types';

/** What the signed-in user may do to members; only shows or hides UI, the API is the authority (ADR-0036). */
export interface CallerRights {
  userId: string;
  owner: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

export function callerRights(access: Access): CallerRights {
  return {
    userId: access.userId,
    owner: access.grants.some((g) => g.scope.type === 'org' && g.roleKey === 'owner'),
    canUpdate: can(access, 'member:update'),
    canDelete: can(access, 'member:delete'),
  };
}

const ROLE_KEYS: readonly OrgRoleKey[] = ['owner', 'admin', 'member', 'viewer'];
// A role key outside the four built-in ones reads as the least powerful tone; its name still shows.
const roleKeyOf = (key: string): OrgRoleKey => ROLE_KEYS.find((k) => k === key) ?? 'viewer';

/** One table row. `projectNames` maps a project id to its name; a project the caller cannot see shows no entry. */
export function toMemberRow(dto: MemberDto, caller: CallerRights, projectNames: Map<string, string>): MemberRowView {
  const orgRole = dto.assignments.find((a) => a.scope.type === 'org')?.role;
  const projectRoles = dto.assignments
    .flatMap((a) => {
      if (a.scope.type !== 'project') return [];
      const name = projectNames.get(a.scope.projectId);
      return name === undefined ? [] : [{ name, text: `${name} (${a.role.name})` }];
    })
    .sort((x, y) => x.name.localeCompare(y.name))
    .map((p) => p.text);
  const you = dto.userId === caller.userId;
  const ownerRow = orgRole?.key === 'owner';
  const mayTouch = !ownerRow || caller.owner;
  return {
    userId: dto.userId,
    name: dto.name,
    handle: dto.handle ?? dto.name,
    you,
    role: orgRole ? { key: roleKeyOf(orgRole.key), name: orgRole.name } : null,
    projectRoles: projectRoles.length > 0 ? projectRoles.join(', ') : '—',
    canChangeRole: caller.canUpdate && mayTouch,
    canRemove: caller.canDelete && !you && mayTouch,
  };
}
