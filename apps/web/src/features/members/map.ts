import { can, type Access, type MemberDto } from '@agentdesk/contracts';
import type { MemberRowView, OrgRoleKey } from '@/mocks/types';

/** What the signed-in user may do to members; only shows or hides UI, the API is the authority (ADR-0036). */
export interface CallerRights {
  userId: string;
  owner: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** `assignment:create` and `assignment:delete` at org level: the project access section of Change access. */
  canAssign: boolean;
}

export function callerRights(access: Access): CallerRights {
  return {
    userId: access.userId,
    owner: access.grants.some((g) => g.scope.type === 'org' && g.roleKey === 'owner'),
    canUpdate: can(access, 'member:update'),
    canDelete: can(access, 'member:delete'),
    canAssign: can(access, 'assignment:create') && can(access, 'assignment:delete'),
  };
}

const ROLE_KEYS: readonly OrgRoleKey[] = ['owner', 'admin', 'member', 'viewer'];
// A role key outside the four built-in ones reads as the least powerful tone; its name still shows.
const roleKeyOf = (key: string): OrgRoleKey => ROLE_KEYS.find((k) => k === key) ?? 'viewer';

/** The scope name of an org-level grant in a row. */
export const ORG_SCOPE_NAME = 'Organization';

/** One table row. `projectNames` maps a project id to its name; a project the caller cannot see shows no entry. */
export function toMemberRow(dto: MemberDto, caller: CallerRights, projectNames: Map<string, string>): MemberRowView {
  const orgAssignment = dto.assignments.find((a) => a.scope.type === 'org');
  const orgRole = orgAssignment?.role;
  const projectGrants = dto.assignments
    .flatMap((a) => {
      if (a.scope.type !== 'project') return [];
      const name = projectNames.get(a.scope.projectId);
      return name === undefined ? [] : [{ id: a.id, scopeName: name, roleName: a.role.name }];
    })
    .sort((x, y) => x.scopeName.localeCompare(y.scopeName));
  const grants = [
    ...(orgAssignment ? [{ id: orgAssignment.id, scopeName: ORG_SCOPE_NAME, roleName: orgAssignment.role.name }] : []),
    ...projectGrants,
  ];
  const you = dto.userId === caller.userId;
  const ownerRow = orgRole?.key === 'owner';
  const mayTouch = !ownerRow || caller.owner;
  return {
    userId: dto.userId,
    name: dto.name,
    handle: dto.handle ?? dto.name,
    you,
    role: orgRole ? { key: roleKeyOf(orgRole.key), name: orgRole.name } : null,
    grants,
    // nobody changes their own role (the API refuses it too: this only hides the action)
    canChangeRole: caller.canUpdate && mayTouch && !you,
    canRemove: caller.canDelete && !you && mayTouch,
  };
}
