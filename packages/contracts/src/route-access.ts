import type { Permission, PlatformPermission } from './access';
import type { Routes } from './routes';

export type RouteKey = { [G in keyof Routes]: `${G & string}.${keyof Routes[G] & string}` }[keyof Routes];

export type ProjectParam = 'projectId' | 'runId' | 'ruleId' | 'agentId' | 'setupTestId';

/** How the API guard authorises a route. `project` resolves the project from the named path param. */
export type RouteAccess =
  | { scope: 'org'; permission: Permission }
  | { scope: 'project'; permission: Permission; param: ProjectParam }
  | { scope: 'project-list'; permission: Permission }
  | { scope: 'self' }
  | { scope: 'user' }
  | { scope: 'org-admin'; anyOf: readonly Permission[] }
  | { scope: 'platform'; permission: PlatformPermission };

const org = (permission: Permission): RouteAccess => ({ scope: 'org', permission });
const project = (permission: Permission, param: ProjectParam = 'projectId'): RouteAccess => ({
  scope: 'project',
  permission,
  param,
});
const orgAdmin = (...anyOf: Permission[]): RouteAccess => ({ scope: 'org-admin', anyOf });
const platform = (permission: PlatformPermission): RouteAccess => ({ scope: 'platform', permission });

export const routeAccess: Record<RouteKey, RouteAccess> = {
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
  'me.listInvitations': { scope: 'user' },
  'me.getInvitation': { scope: 'user' },
  'me.acceptInvitation': { scope: 'user' },
  'me.declineInvitation': { scope: 'user' },
  'roles.list': orgAdmin('assignment:read'),
  'projectMembers.list': project('assignment:read'),
  'projectMembers.add': project('assignment:create'),
  'projectMembers.setRole': project('assignment:create'),
  'projectMembers.remove': project('assignment:delete'),
  'projects.audit': project('project-audit:read'),
  'members.list': orgAdmin('member:read', 'assignment:create'),
  'assignments.list': orgAdmin('assignment:read'),
  'assignments.create': orgAdmin('assignment:create'),
  'assignments.remove': orgAdmin('assignment:delete'),
  'invitations.list': orgAdmin('member:read', 'assignment:read'),
  'invitations.create': orgAdmin('member:create', 'assignment:create'),
  'invitations.remove': orgAdmin('member:create', 'assignment:create'),
  'invitations.resend': orgAdmin('member:create', 'assignment:create'),
  'members.updateRole': org('member:update'),
  'members.remove': org('member:delete'),
  'orgs.update': org('org:update'),
  'audit.list': org('audit:read'),
  'orgs.checklist': org('project:create'),
  'platform.createOrg': platform('platform-org:create'),
  'platform.listOrgs': platform('platform-org:read'),
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
