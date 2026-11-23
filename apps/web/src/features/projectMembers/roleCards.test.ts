import type { RoleDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { roleFixtures } from '@/mocks/dto/access';
import { projectRoleCards } from './roleCards';

describe('projectRoleCards (BR-6)', () => {
  it('offers Admin, Member and Viewer with the project role texts, never Owner', () => {
    const cards = projectRoleCards(roleFixtures);
    expect(cards.map((c) => [c.key, c.name, c.description])).toEqual([
      ['admin', 'Admin', "Manage this project's members, agent, rules, skills and setup."],
      ['member', 'Member', 'See runs, start runs and act on their own runs.'],
      ['viewer', 'Viewer', 'See this project and its runs.'],
    ]);
    expect(cards.every((c) => c.roleId !== null)).toBe(true);
  });

  it('leaves out a role that cannot be given on a project', () => {
    const roles: RoleDto[] = roleFixtures.map((r) => (r.key === 'viewer' ? { ...r, assignableScopes: ['org'] } : r));
    expect(projectRoleCards(roles).map((c) => c.key)).toEqual(['admin', 'member']);
  });
});
