import type { RoleDto } from '@agentdesk/contracts';
import type { RoleCardOption } from '@/mocks/types';

// Card copy is fixed by the spec ("UI and Storybook › Copy"); the API only supplies the role ids.
const BUILT_IN = [
  { key: 'owner', description: 'Everything an admin can do, and manage owners.' },
  { key: 'admin', description: 'Manage members, invitations, projects and settings.' },
  { key: 'member', description: 'Use projects and start runs.' },
  { key: 'viewer', description: 'See projects and runs.' },
] as const;

const NO_ROLE: RoleCardOption = {
  roleId: null,
  key: 'none',
  name: 'No role',
  description: 'Stays a member with no organization role. Project roles stay.',
};

/** Owner, Admin, Member, Viewer and No role cards; Owner only for an owner caller (UI only: the API refuses the rest). */
export function roleCards(roles: RoleDto[], callerIsOwner: boolean): RoleCardOption[] {
  const cards = BUILT_IN.flatMap(({ key, description }): RoleCardOption[] => {
    if (key === 'owner' && !callerIsOwner) return [];
    const role = roles.find((r) => r.key === key && r.assignableScopes.includes('org'));
    return role ? [{ roleId: role.id, key, name: role.name, description }] : [];
  });
  return [...cards, NO_ROLE];
}
