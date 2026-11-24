import { describe, expect, it } from 'vitest';
import type { AssignmentDto, MemberDto } from '@agentdesk/contracts';
import { callerRights, toMemberRow, type CallerRights } from './map';
import { toAccess } from '@/features/access/queries';
import { tenantAccessFixtures } from '@/mocks/dto/access';

const ref = (key: string) => ({ id: `role-${key}`, key, name: key[0]?.toUpperCase() + key.slice(1) });
const asg = (key: string, scope: AssignmentDto['scope']): AssignmentDto => ({
  id: `a-${key}-${scope.type}`,
  userId: 'u',
  role: ref(key),
  scope,
  grantedBy: null,
  grantedAt: '2026-10-05T10:30:00.000Z',
});
const member = (userId: string, assignments: AssignmentDto[], over: Partial<MemberDto> = {}): MemberDto => ({
  userId,
  handle: userId,
  name: `Name ${userId}`,
  assignments,
  ...over,
});
const names = new Map([
  ['p-alpha', 'Alpha'],
  ['p-beta', 'Beta'],
]);
const ownerCaller: CallerRights = { userId: 'me', owner: true, canUpdate: true, canDelete: true, canAssign: true };
const adminCaller: CallerRights = { userId: 'me', owner: false, canUpdate: true, canDelete: true, canAssign: true };
const org = { type: 'org' } as const;

describe('toMemberRow: role and project roles (BR-1)', () => {
  it.each([
    ['the org-scope role', [asg('admin', org)], { key: 'admin', name: 'Admin' }],
    ['no role when only project roles exist', [asg('member', { type: 'project', projectId: 'p-alpha' })], null],
    ['no role without assignments', [], null],
  ])('role from %s', (_n, assignments, role) => {
    expect(toMemberRow(member('x', assignments), ownerCaller, names).role).toEqual(role);
  });

  it.each([
    [[], []],
    [[asg('admin', { type: 'project', projectId: 'p-alpha' })], ['Alpha · Admin']],
    [[asg('admin', org)], ['Organization · Admin']],
    [
      [
        asg('member', { type: 'project', projectId: 'p-beta' }),
        asg('admin', { type: 'project', projectId: 'p-alpha' }),
        asg('owner', org),
      ],
      ['Organization · Owner', 'Alpha · Admin', 'Beta · Member'],
    ],
  ])('grants %#: the org grant first, then projects by name, each as scope and role', (assignments, labels) => {
    const row = toMemberRow(member('x', assignments), ownerCaller, names);
    expect(row.grants.map((g) => `${g.scopeName} · ${g.roleName}`)).toEqual(labels);
  });

  it('keeps every grant of a project the member holds twice, in the order given', () => {
    const alpha = { type: 'project', projectId: 'p-alpha' } as const;
    const row = toMemberRow(
      member('x', [
        { ...asg('member', alpha), id: 'a1' },
        { ...asg('viewer', alpha), id: 'a2' },
      ]),
      ownerCaller,
      names,
    );
    expect(row.grants.map((g) => g.id)).toEqual(['a1', 'a2']);
  });

  it('shows no grant for a project the caller cannot see (nothing of it leaks)', () => {
    const row = toMemberRow(
      member('x', [asg('member', { type: 'project', projectId: 'p-secret' })]),
      ownerCaller,
      names,
    );
    expect(row.grants).toEqual([]);
  });

  it('marks the caller own row and keeps name as given and shows the name alone when there is no handle', () => {
    const row = toMemberRow(member('me', [], { name: 'Me <b>', handle: null }), ownerCaller, names);
    expect(row).toMatchObject({ userId: 'me', you: true, name: 'Me <b>', handle: 'Me <b>' });
    expect(toMemberRow(member('x', []), ownerCaller, names).you).toBe(false);
  });
});

describe('toMemberRow: actions (BR-4, BR-9)', () => {
  it.each<[string, CallerRights, string, boolean, boolean]>([
    ['owner caller, owner row', ownerCaller, 'owner', true, true],
    ['admin caller, owner row', adminCaller, 'owner', false, false],
    ['admin caller, member row', adminCaller, 'member', true, true],
    ['owner caller, own row: no Change role and no Remove', ownerCaller, 'self', false, false],
    ['admin caller, own row: no Change role and no Remove', adminCaller, 'self', false, false],
    ['caller without update or delete', { ...adminCaller, canUpdate: false, canDelete: false }, 'member', false, false],
    ['update only', { ...adminCaller, canDelete: false }, 'member', true, false],
    ['delete only', { ...adminCaller, canUpdate: false }, 'member', false, true],
  ])('%s', (_n, caller, kind, change, remove) => {
    const row =
      kind === 'self' ? member('me', [asg(caller.owner ? 'owner' : 'admin', org)]) : member('t', [asg(kind, org)]);
    expect(toMemberRow(row, caller, names)).toMatchObject({ canChangeRole: change, canRemove: remove });
  });
});

describe('callerRights', () => {
  it.each([
    ['owner', true, true, true],
    ['admin', false, true, true],
    ['member', false, false, false],
  ] as const)('%s', (role, owner, update, del) => {
    expect(callerRights(toAccess(tenantAccessFixtures[role]))).toEqual({
      userId: tenantAccessFixtures[role].userId,
      owner,
      canUpdate: update,
      canDelete: del,
      canAssign: update,
    });
  });
});
