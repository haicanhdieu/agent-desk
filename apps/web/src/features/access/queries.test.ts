import { can, type AccessDto } from '@agentdesk/contracts';
import { describe, expect, it } from 'vitest';
import { roleFixtures } from '@/mocks/dto/access';
import { accessKeys } from './keys';
import { canInvite, orgAccessQuery, sessionAccessQuery, toAccess } from './queries';

const USER = 'user-1';
const PROJECT = '0b1c0000-0000-4000-8000-0000000000aa';

const dto = (assignments: AccessDto['assignments']): AccessDto => ({ userId: USER, platformAdmin: false, assignments });

const owner = dto([
  {
    roleKey: 'owner',
    scope: { type: 'org' },
    permissions: [
      { permission: 'project:create', condition: 'any' },
      { permission: 'assignment:create', condition: 'any' },
    ],
  },
]);
const projectAdmin = dto([
  {
    roleKey: 'project-admin',
    scope: { type: 'project', projectId: PROJECT },
    permissions: [{ permission: 'assignment:create', condition: 'any' }],
  },
]);

describe('toAccess', () => {
  it('maps an org assignment to a grant that can() honours', () => {
    const access = toAccess(owner);
    expect(access.userId).toBe(USER);
    expect(can(access, 'project:create')).toBe(true);
  });

  it('maps a project assignment to a project-scoped grant', () => {
    const access = toAccess(projectAdmin);
    expect(can(access, 'project:create')).toBe(false);
    expect(can(access, 'assignment:create', { projectId: PROJECT })).toBe(true);
  });
});

/** An org-scope assignment built from the built-in role the mock API seeds, as `me.access` returns it. */
const asRole = (key: string): AccessDto => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`no seeded role ${key}`);
  return dto([{ roleKey: role.key, scope: { type: 'org' }, permissions: role.permissions }]);
};

describe('canInvite', () => {
  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
    ['viewer', false],
  ])('for the built-in %s role: %s', (key, expected) => {
    expect(canInvite(toAccess(asRole(key)))).toBe(expected);
  });

  it('is true for a project admin (invite rights on one project)', () => {
    expect(canInvite(toAccess(projectAdmin))).toBe(true);
  });

  it('is false for a user with no assignment', () => {
    expect(canInvite(toAccess(dto([])))).toBe(false);
  });
});

describe('access query keys', () => {
  it('pins the session and org-scoped keys', () => {
    expect(accessKeys.session()).toEqual(['session', 'access']);
    expect(accessKeys.org('acme')).toEqual(['org', 'acme', 'access']);
    expect(sessionAccessQuery.queryKey).toEqual(['session', 'access']);
    expect(orgAccessQuery('acme').queryKey).toEqual(['org', 'acme', 'access']);
  });
});
