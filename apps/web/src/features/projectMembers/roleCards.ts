import type { RoleDto } from '@agentdesk/contracts';
import type { RoleCardOption } from '@/mocks/types';

// Card copy is fixed by the spec ("UI and Storybook › Copy"); the API only supplies the role ids.
const PROJECT_ROLES = [
  { key: 'admin', description: "Manage this project's members, agent, rules, skills and setup." },
  { key: 'member', description: 'See runs, start runs and act on their own runs.' },
  { key: 'viewer', description: 'See this project and its runs.' },
] as const;

/** Admin, Member and Viewer cards for the roles a project can hold; never Owner (UI only: the API refuses it too). */
export function projectRoleCards(roles: RoleDto[]): RoleCardOption[] {
  return PROJECT_ROLES.flatMap(({ key, description }): RoleCardOption[] => {
    const role = roles.find((r) => r.key === key && r.assignableScopes.includes('project'));
    return role ? [{ roleId: role.id, key, name: role.name, description }] : [];
  });
}
