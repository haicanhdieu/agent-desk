import { describe, expect, it } from 'vitest';
import {
  OWNABLE_PERMISSIONS,
  Permission,
  can,
  flattenRoutes,
  holdsAnywhere,
  routeAccess,
  routes,
  type Access,
  type GrantLine,
  type PermissionCondition,
  type RouteAccess,
  type RouteKey,
} from './index';

// One written matrix (issue 216, docs/superpowers/specs/2026-11-22-desk-access-matrix.md): what each built-in role
// gets from every route at org scope. `any` is allowed, `own` is allowed on the caller's own runs only, `no` is 403.
// The role contents below are pinned to the seeded templates by packages/core/test/access/role-templates.int.test.ts,
// so a seed change, a route permission change or a matrix change that widens access fails one of the two tests.

type Result = 'any' | 'own' | 'no';
type Row = readonly [owner: Result, admin: Result, member: Result, viewer: Result];

const TENANT = Permission.options.filter((p) => !p.startsWith('platform-'));
const line = (permission: Permission, condition: PermissionCondition = 'any'): GrantLine => ({ permission, condition });

const ROLES = {
  owner: TENANT.map((p) => line(p)),
  admin: TENANT.filter((p) => p !== 'org:delete').map((p) => line(p)),
  member: [
    ...(['project:read', 'run:read', 'run:create'] as const).map((p) => line(p)),
    ...OWNABLE_PERMISSIONS.map((p) => line(p, 'own')),
  ],
  viewer: [line('project:read'), line('run:read')],
};
const ROLE_KEYS = ['owner', 'admin', 'member', 'viewer'] as const;

const accessOf = (key: (typeof ROLE_KEYS)[number]): Access => ({
  userId: 'u1',
  grants: [{ roleId: key, roleKey: key, scope: { type: 'org' }, lines: ROLES[key] }],
});

/** What the guard decides for a caller whose only assignment is `access`, whatever the target (own lines apply to own runs only). */
function resultOf(entry: RouteAccess, access: Access): Result {
  switch (entry.scope) {
    case 'self':
    case 'user':
      return 'any';
    case 'platform':
      return 'no';
    case 'org-admin':
      return entry.anyOf.some((p) => holdsAnywhere(access, p)) ? 'any' : 'no';
    case 'org':
      return can(access, entry.permission) ? 'any' : 'no';
    case 'project':
    case 'project-list': {
      if (can(access, entry.permission, { projectId: 'p1' })) return 'any';
      return holdsAnywhere(access, entry.permission) ? 'own' : 'no';
    }
  }
}

const ALL: Row = ['any', 'any', 'any', 'any'];
const ADMINS: Row = ['any', 'any', 'no', 'no'];
const NOBODY: Row = ['no', 'no', 'no', 'no'];
const MEMBER_PLUS: Row = ['any', 'any', 'any', 'no'];
const OWN_RUN: Row = ['any', 'any', 'own', 'no'];

const MATRIX: Record<RouteKey, Row> = {
  'connections.list': ADMINS,
  'connections.install': ADMINS,
  'connections.sync': ADMINS,
  'connections.repos': ADMINS,
  'projects.list': ALL,
  'projects.create': ADMINS,
  'projects.get': ALL,
  'projects.update': ADMINS,
  'projects.remove': ADMINS,
  'projects.connection': ALL,
  'projects.pollNow': MEMBER_PLUS,
  'projects.ignored': ALL,
  'projects.events': ALL,
  // Desk configuration: admin and owner only (issue 216, option 1)
  'agents.get': ADMINS,
  'agents.put': ADMINS,
  'agents.putCredential': ADMINS,
  'agents.models': ADMINS,
  'skills.list': ADMINS,
  'skills.get': ADMINS,
  'skills.put': ADMINS,
  'skills.remove': ADMINS,
  'rules.list': ADMINS,
  'rules.create': ADMINS,
  'rules.update': ADMINS,
  'rules.promptPreview': ADMINS,
  'rules.remove': ADMINS,
  'setupScript.get': ADMINS,
  'setupScript.put': ADMINS,
  'setupScript.versions': ADMINS,
  'setupScript.version': ADMINS,
  'setup.plugins': ADMINS,
  'setupTests.create': ADMINS,
  'setupTests.latest': ADMINS,
  'setupTests.end': ADMINS,
  'setupTests.events': ADMINS,
  // terminal:attach is `own` for a member, but a member starts no setup test, so the socket stays closed to them
  'setupTests.terminal': ['any', 'any', 'own', 'no'],
  'tickets.prStates': ALL,
  'runs.list': ALL,
  'runs.stats': ALL,
  'runs.byNumber': ALL,
  'runs.get': ALL,
  'runs.log': ALL,
  'runs.cancel': OWN_RUN,
  'runs.finish': OWN_RUN,
  'runs.resume': OWN_RUN,
  'runs.stop': OWN_RUN,
  'runs.closeSession': OWN_RUN,
  'runs.transcript': ALL,
  'runs.events': ALL,
  'runs.terminal': OWN_RUN,
  'me.access': ALL,
  'me.platform': ALL,
  'me.listInvitations': ALL,
  'me.getInvitation': ALL,
  'me.acceptInvitation': ALL,
  'me.declineInvitation': ALL,
  'roles.list': ADMINS,
  'projectMembers.list': ADMINS,
  'projectMembers.add': ADMINS,
  'projectMembers.setRole': ADMINS,
  'projectMembers.remove': ADMINS,
  'projects.audit': ADMINS,
  'members.list': ADMINS,
  'assignments.list': ADMINS,
  'assignments.create': ADMINS,
  'assignments.remove': ADMINS,
  'invitations.list': ADMINS,
  'invitations.create': ADMINS,
  'invitations.remove': ADMINS,
  'invitations.resend': ADMINS,
  'members.updateRole': ADMINS,
  'members.remove': ADMINS,
  'orgs.update': ADMINS,
  'audit.list': ADMINS,
  'orgs.checklist': ADMINS,
  'platform.createOrg': NOBODY,
  'platform.listOrgs': NOBODY,
  'platform.getOrg': NOBODY,
  'platform.listProjects': NOBODY,
  'platform.listRoles': NOBODY,
  'platform.listMembers': NOBODY,
  'platform.listAssignments': NOBODY,
  'platform.createAssignment': NOBODY,
  'platform.removeAssignment': NOBODY,
  'platform.listInvitations': NOBODY,
  'platform.createInvitation': NOBODY,
  'platform.removeInvitation': NOBODY,
  'platform.resendInvitation': NOBODY,
  'platform.listAdmins': NOBODY,
  'platform.grantAdmin': NOBODY,
  'platform.revokeAdmin': NOBODY,
  'platform.suspendOrg': NOBODY,
  'platform.reactivateOrg': NOBODY,
};

describe('role matrix over routeAccess', () => {
  it('has a row for every route key and no other', () => {
    expect(Object.keys(MATRIX).sort()).toEqual(Object.keys(flattenRoutes(routes)).sort());
  });

  it.each(ROLE_KEYS.map((key, i) => [key, i] as const))('gives %s exactly the access the matrix lists', (key, i) => {
    const access = accessOf(key);
    const got = Object.fromEntries(
      (Object.keys(routeAccess) as RouteKey[]).map((k) => [k, resultOf(routeAccess[k], access)]),
    );
    const want = Object.fromEntries((Object.keys(MATRIX) as RouteKey[]).map((k) => [k, MATRIX[k][i]]));
    expect(got).toEqual(want);
  });

  it('gives member and viewer no Desk configuration route at all', () => {
    const desk = (Object.keys(routeAccess) as RouteKey[]).filter((k) =>
      /^(agents|skills|rules|setupScript|setup|setupTests)\./.test(k),
    );
    expect(desk.length).toBeGreaterThan(20);
    for (const key of ['member', 'viewer'] as const) {
      for (const k of desk.filter((d) => d !== 'setupTests.terminal')) {
        expect(resultOf(routeAccess[k], accessOf(key)), `${key} ${k}`).toBe('no');
      }
    }
  });
});
