import { describe, expect, it } from 'vitest';
import { flattenRoutes, isPlatformPermission, routeAccess, routes } from './index';
import type { RouteAccess, RouteKey } from './index';

const org = (permission: Extract<RouteAccess, { scope: 'org' }>['permission']): RouteAccess => ({
  scope: 'org',
  permission,
});
const project = (
  permission: Extract<RouteAccess, { scope: 'project' }>['permission'],
  param: Extract<RouteAccess, { scope: 'project' }>['param'] = 'projectId',
): RouteAccess => ({ scope: 'project', permission, param });
const admin = (...anyOf: Extract<RouteAccess, { scope: 'org-admin' }>['anyOf'][number][]): RouteAccess => ({
  scope: 'org-admin',
  anyOf,
});
const platform = (permission: Extract<RouteAccess, { scope: 'platform' }>['permission']): RouteAccess => ({
  scope: 'platform',
  permission,
});

const expected: Record<RouteKey, RouteAccess> = {
  'connections.list': org('connection:read'),
  'connections.install': org('connection:create'),
  'connections.sync': org('connection:create'),
  'connections.repos': org('connection:read'),
  'projects.list': { scope: 'project-list', permission: 'project:read' },
  'projects.create': org('project:create'),
  'projects.get': project('project:read'),
  'projects.update': project('project:update'),
  'projects.remove': project('project:delete'),
  'projects.connection': project('project:read'),
  'projects.pollNow': project('run:create'),
  'projects.ignored': project('project:read'),
  'projects.events': project('run:read'),
  'agents.get': project('agent:read'),
  'agents.put': project('agent:update'),
  'agents.putCredential': project('secret:update', 'agentId'),
  'agents.models': project('agent:read', 'agentId'),
  'skills.list': project('skill:read'),
  'skills.get': project('skill:read'),
  'skills.put': project('skill:update'),
  'skills.remove': project('skill:delete'),
  'rules.list': project('rule:read'),
  'rules.create': project('rule:create'),
  'rules.update': project('rule:update', 'ruleId'),
  'rules.promptPreview': project('rule:read'),
  'rules.remove': project('rule:delete', 'ruleId'),
  'setupScript.get': project('setup:read'),
  'setupScript.put': project('setup:update'),
  'setupScript.versions': project('setup:read'),
  'setupScript.version': project('setup:read'),
  'setup.plugins': project('setup:read'),
  'setupTests.create': project('setup:test'),
  'setupTests.latest': project('setup:read'),
  'setupTests.end': project('setup:test', 'setupTestId'),
  'setupTests.events': project('setup:read', 'setupTestId'),
  'setupTests.terminal': project('terminal:attach', 'setupTestId'),
  'tickets.prStates': project('run:read'),
  'runs.list': project('run:read'),
  'runs.stats': project('run:read'),
  'runs.byNumber': project('run:read'),
  'runs.get': project('run:read', 'runId'),
  'runs.log': project('run:read', 'runId'),
  'runs.cancel': project('run:cancel', 'runId'),
  'runs.finish': project('run:update', 'runId'),
  'runs.resume': project('run:update', 'runId'),
  'runs.stop': project('run:update', 'runId'),
  'runs.closeSession': project('run:update', 'runId'),
  'runs.transcript': project('run:read', 'runId'),
  'runs.events': project('run:read', 'runId'),
  'runs.terminal': project('terminal:attach', 'runId'),
  'me.access': { scope: 'self' },
  'me.platform': { scope: 'user' },
  'me.listInvitations': { scope: 'user' },
  'me.getInvitation': { scope: 'user' },
  'me.acceptInvitation': { scope: 'user' },
  'me.declineInvitation': { scope: 'user' },
  'roles.list': admin('assignment:read'),
  'members.list': admin('member:read', 'assignment:create'),
  'assignments.list': admin('assignment:read'),
  'assignments.create': admin('assignment:create'),
  'assignments.remove': admin('assignment:delete'),
  'invitations.list': admin('member:read', 'assignment:read'),
  'invitations.create': admin('member:create', 'assignment:create'),
  'invitations.remove': admin('member:create', 'assignment:create'),
  'invitations.resend': admin('member:create', 'assignment:create'),
  'members.updateRole': org('member:update'),
  'members.remove': org('member:delete'),
  'orgs.update': org('org:update'),
  'audit.list': org('audit:read'),
  'orgs.checklist': org('project:create'),
  'platform.createOrg': platform('platform-org:create'),
  'platform.listOrgs': platform('platform-org:read'),
  'platform.getOrg': platform('platform-org:read'),
  'platform.listProjects': platform('platform-project:read'),
  'platform.listRoles': platform('platform-role:read'),
  'platform.listMembers': platform('platform-member:read'),
  'platform.listAssignments': platform('platform-assignment:read'),
  'platform.createAssignment': platform('platform-assignment:create'),
  'platform.removeAssignment': platform('platform-assignment:delete'),
  'platform.listInvitations': platform('platform-invitation:read'),
  'platform.createInvitation': platform('platform-invitation:create'),
  'platform.removeInvitation': platform('platform-invitation:delete'),
  'platform.resendInvitation': platform('platform-invitation:update'),
  'platform.listAdmins': platform('platform-admin:read'),
  'platform.grantAdmin': platform('platform-admin:create'),
  'platform.revokeAdmin': platform('platform-admin:delete'),
};

const flat = flattenRoutes(routes);

describe('routeAccess', () => {
  it('matches the approved permission map for all 86 keys', () => {
    expect(Object.keys(expected)).toHaveLength(86);
    expect(routeAccess).toEqual(expected);
  });

  it('covers exactly the route table keys', () => {
    expect(Object.keys(routeAccess).sort()).toEqual(Object.keys(flat).sort());
  });

  it('uses platform scope exactly for /api/platform/ paths, with a platform permission', () => {
    for (const [key, access] of Object.entries(routeAccess)) {
      const isPlatformPath = flat[key]?.path.startsWith('/api/platform/') ?? false;
      expect(access.scope === 'platform', key).toBe(isPlatformPath);
      if (access.scope === 'platform') expect(isPlatformPermission(access.permission), key).toBe(true);
    }
  });

  it('uses org-admin only on /api/orgs/ paths, self only on me.access and user only on the other me.* keys', () => {
    for (const [key, access] of Object.entries(routeAccess)) {
      if (access.scope === 'org-admin') expect(flat[key]?.path.startsWith('/api/orgs/'), key).toBe(true);
      expect(access.scope === 'self', key).toBe(key === 'me.access');
      expect(access.scope === 'user', key).toBe(key.startsWith('me.') && key !== 'me.access');
    }
  });

  it('names a project param that the path carries', () => {
    for (const [key, access] of Object.entries(routeAccess)) {
      if (access.scope === 'project') expect(flat[key]?.path, key).toContain(`:${access.param}`);
    }
  });
});
