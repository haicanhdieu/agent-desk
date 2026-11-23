import { describe, expect, it } from 'vitest';
import { roleFixtures } from '@/mocks/dto/access';
import { roleCards } from './roleCards';

describe('roleCards (BR-4, TC-4.1, TC-4.3)', () => {
  it('TC-4.3 an owner caller gets Owner, Admin, Member, Viewer and No role with the spec descriptions', () => {
    const cards = roleCards(roleFixtures, true);
    expect(cards.map((c) => [c.key, c.name, c.description])).toEqual([
      ['owner', 'Owner', 'Everything an admin can do, and manage owners.'],
      ['admin', 'Admin', 'Manage members, invitations, projects and settings.'],
      ['member', 'Member', 'Use projects and start runs.'],
      ['viewer', 'Viewer', 'See projects and runs.'],
      ['none', 'No role', 'Stays a member with no organization role. Project roles stay.'],
    ]);
    expect(cards.map((c) => c.roleId)).toEqual([
      ...['owner', 'admin', 'member', 'viewer'].map((k) => roleFixtures.find((r) => r.key === k)?.id),
      null,
    ]);
  });

  it('TC-4.1 an admin caller gets no Owner card', () => {
    expect(roleCards(roleFixtures, false).map((c) => c.key)).toEqual(['admin', 'member', 'viewer', 'none']);
  });

  it('a role the API did not list gets no card; a custom role is never offered', () => {
    const roles = roleFixtures
      .filter((r) => r.key !== 'viewer')
      .flatMap((r) => (r.key === 'member' ? [r, { ...r, id: 'custom-1', key: 'custom', name: 'Auditor' }] : [r]));
    expect(roleCards(roles, true).map((c) => c.key)).toEqual(['owner', 'admin', 'member', 'none']);
  });
});
