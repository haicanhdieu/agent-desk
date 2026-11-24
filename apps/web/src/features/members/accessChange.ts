import type { MemberDto } from '@agentdesk/contracts';
import type { AccessChange, ProjectGrantView } from '@/mocks/types';

/** The role id of the member's org-scope grant (null = No role). */
export const orgRoleIdOf = (dto: MemberDto): string | null =>
  dto.assignments.find((a) => a.scope.type === 'org')?.role.id ?? null;

/** The member's project grants the caller can see (`projectNames` has only those), sorted by project name. */
export function projectGrantsOf(dto: MemberDto, projectNames: Map<string, string>): ProjectGrantView[] {
  return dto.assignments
    .flatMap((a): ProjectGrantView[] => {
      if (a.scope.type !== 'project') return [];
      const projectName = projectNames.get(a.scope.projectId);
      return projectName === undefined
        ? []
        : [{ assignmentId: a.id, projectId: a.scope.projectId, projectName, roleId: a.role.id, roleName: a.role.name }];
    })
    .sort((x, y) => x.projectName.localeCompare(y.projectName));
}

export interface AccessDiff {
  /** The org role differs from the current one. */
  setOrgRole: boolean;
  create: { projectId: string; roleId: string }[];
  /** Assignment ids to revoke. */
  remove: string[];
}

/** What a save has to send: the org role if it changed, grants to create, grants to revoke. A changed role is a create plus a remove. */
export function diffAccess(
  currentOrgRoleId: string | null,
  current: ProjectGrantView[],
  wanted: AccessChange,
): AccessDiff {
  const create: AccessDiff['create'] = [];
  const kept = new Set<string>();
  for (const w of wanted.projects) {
    // A grant is its project and role (the API's unique key), so a removed-then-re-added row is the same grant.
    const before = current.find((c) => c.projectId === w.projectId && c.roleId === w.roleId);
    if (before !== undefined) kept.add(before.assignmentId);
    else if (!create.some((c) => c.projectId === w.projectId && c.roleId === w.roleId))
      create.push({ projectId: w.projectId, roleId: w.roleId });
  }
  return {
    setOrgRole: wanted.roleId !== currentOrgRoleId,
    create,
    remove: current.filter((c) => !kept.has(c.assignmentId)).map((c) => c.assignmentId),
  };
}
