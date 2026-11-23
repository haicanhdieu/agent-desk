import { describe, expect, it } from 'vitest';
import {
  AGENT_TIMEOUT_SECONDS_DEFAULT,
  AGENT_TIMEOUT_SECONDS_MAX,
  AGENT_TIMEOUT_SECONDS_MIN,
  SETUP_SCRIPT_MAX_BYTES,
  SetupScriptBody,
  CreateRuleRequest,
  PutAgentRequest,
  RunListQuery,
  RunListResponse,
  UpdateProjectRequest,
  flattenRoutes,
  routes,
} from './index';

const validRule = {
  command: 'review',
  labelFilter: [],
  target: 'pr',
  kind: 'skill',
  skillName: 'review',
  enabled: true,
};

describe('contracts', () => {
  it('every route has method, /api path and a response schema', () => {
    for (const [, r] of Object.entries(flattenRoutes(routes))) {
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(r.method);
      expect(r.path.startsWith('/api/')).toBe(true);
      expect(r.response).toBeDefined();
    }
  });
  it('every platform route lives under /api/platform/', () => {
    const platform = Object.entries(flattenRoutes(routes)).filter(([k]) => k.startsWith('platform.'));
    expect(platform).toHaveLength(15);
    for (const [, r] of platform) expect(r.path.startsWith('/api/platform/')).toBe(true);
  });
  it('platform admin routes are listed, granted and revoked under /api/platform/admins', () => {
    expect(routes.platform.listAdmins).toMatchObject({ method: 'GET', path: '/api/platform/admins' });
    expect(routes.platform.grantAdmin).toMatchObject({ method: 'POST', path: '/api/platform/admins' });
    expect(routes.platform.revokeAdmin).toMatchObject({ method: 'DELETE', path: '/api/platform/admins/:adminId' });
    expect(routes.platform.revokeAdmin.params.safeParse({ adminId: 'not-a-uuid' }).success).toBe(false);
    expect(
      routes.platform.revokeAdmin.params.safeParse({ adminId: '00000000-0000-4000-8000-000000000001' }).success,
    ).toBe(true);
  });
  it('assignments.list query keeps projectId', () => {
    const P = '00000000-0000-4000-8000-000000000001';
    expect(routes.assignments.list.query.parse({ projectId: P })).toMatchObject({ projectId: P });
  });
  it('flattenRoutes uses dotted keys', () => {
    const flat = flattenRoutes(routes);
    expect(Object.keys(flat)).toContain('runs.list');
    expect(Object.keys(flat)).toContain('agents.putCredential');
    expect(flat['runs.resume']).toMatchObject({ method: 'POST', path: '/api/runs/:runId/resume' });
    expect(flat['runs.stop']).toMatchObject({ method: 'POST', path: '/api/runs/:runId/stop' });
    expect(flat['runs.closeSession']).toMatchObject({ method: 'POST', path: '/api/runs/:runId/close-session' });
    expect(flat['runs.transcript']).toMatchObject({ method: 'GET', path: '/api/runs/:runId/transcript' });
    expect(flat['projects.pollNow']).toMatchObject({
      method: 'POST',
      path: '/api/projects/:projectId/connection/poll',
    });
    expect(Object.keys(flat)).toHaveLength(89);
    expect(flat['assignments.remove']).toMatchObject({
      method: 'DELETE',
      path: '/api/orgs/:orgId/assignments/:assignmentId',
    });
    expect(flat['tickets.prStates']).toMatchObject({
      method: 'GET',
      path: '/api/projects/:projectId/tickets/pr-states',
    });
    expect(flat['runs.stats']).toMatchObject({ method: 'GET', path: '/api/projects/:projectId/runs/stats' });
    expect(flat['agents.models']).toMatchObject({ method: 'GET', path: '/api/agents/:agentId/models' });
  });
  it('rejects timeoutSeconds above 7 days', () => {
    expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 604801 }).success).toBe(false);
  });
  it('accepts only allowed poll intervals', () => {
    expect(UpdateProjectRequest.safeParse({ pollIntervalSeconds: 120 }).success).toBe(false);
    expect(UpdateProjectRequest.safeParse({ pollIntervalSeconds: 600 }).success).toBe(true);
  });
  it('rule command must be lowercase slug without slash', () => {
    expect(CreateRuleRequest.safeParse({ ...validRule, command: '/Review' }).success).toBe(false);
    expect(CreateRuleRequest.safeParse(validRule).success).toBe(true);
  });
});

describe('setup script contract', () => {
  it('measures the 64 KiB limit in UTF-8 bytes', () => {
    expect(SETUP_SCRIPT_MAX_BYTES).toBe(65536);
    expect(SetupScriptBody.safeParse('é'.repeat(32768)).success).toBe(true);
    expect(SetupScriptBody.safeParse('é'.repeat(32768) + 'a').success).toBe(false);
  });
  it('rejects a NUL character (Postgres text cannot store it)', () => {
    expect(SetupScriptBody.safeParse('a\u0000b').success).toBe(false);
    expect(SetupScriptBody.safeParse('a\u0001b\tc').success).toBe(true);
  });
  it('bounds the version param to a Postgres integer', () => {
    const params = routes.setupScript.version.params;
    const projectId = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
    expect(params.safeParse({ projectId, version: '2147483647' }).success).toBe(true);
    expect(params.safeParse({ projectId, version: '2147483648' }).success).toBe(false);
    expect(params.safeParse({ projectId, version: '9999999999' }).success).toBe(false);
  });
  it('registers the four setupScript routes', () => {
    const flat = flattenRoutes(routes);
    expect(
      Object.keys(flat)
        .filter((k) => k.startsWith('setupScript.'))
        .sort(),
    ).toEqual(['setupScript.get', 'setupScript.put', 'setupScript.version', 'setupScript.versions']);
  });
});

describe('contract boundaries', () => {
  it('PutAgentRequest accepts timeoutSeconds 60 to 604800 (7 days) and rejects outside', () => {
    for (const ok of [60, 3301, 86400, 604800]) {
      expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: ok }).success, String(ok)).toBe(true);
    }
    for (const bad of [59, 604801, 1.5]) {
      expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: bad }).success, String(bad)).toBe(false);
    }
  });
  it('the over-limit message names the limit in days, at the field pointer', () => {
    const r = PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 604801 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['timeoutSeconds']);
    expect(r.error?.issues[0]?.message).toMatch(/7 days/);
  });
  it('exports the run time limit bounds: 60 s, 7 days, default 24 h', () => {
    expect([AGENT_TIMEOUT_SECONDS_MIN, AGENT_TIMEOUT_SECONDS_MAX, AGENT_TIMEOUT_SECONDS_DEFAULT]).toEqual([
      60, 604800, 86400,
    ]);
  });
  it('runs.list takes a page query and answers with a page envelope', () => {
    expect(RunListQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(RunListQuery.parse({ filter: 'ended', q: 'login', page: '3', pageSize: '50' })).toEqual({
      filter: 'ended',
      q: 'login',
      page: 3,
      pageSize: 50,
    });
    expect(RunListQuery.parse({ q: '  fix the login  ' }).q).toBe('fix the login');
    expect(RunListQuery.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
    // The exact `ticket` ref stays beside `q`; both may be given (the server ANDs them).
    expect(RunListQuery.parse({ ticket: '7', q: 'login' })).toEqual({ ticket: '7', q: 'login', page: 1, pageSize: 20 });
    expect(RunListQuery.safeParse({ limit: '5' }).success).toBe(false);
    expect(RunListQuery.safeParse({ cursor: 'x' }).success).toBe(false);
    expect(RunListQuery.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(RunListResponse.safeParse({ items: [], page: 1, pageSize: 20, total: 0 }).success).toBe(true);
    expect(RunListResponse.safeParse({ items: [], nextCursor: null }).success).toBe(false);
  });

  it('registers rules.promptPreview under the project rules path', () => {
    const r = flattenRoutes(routes)['rules.promptPreview'];
    expect(r?.method).toBe('GET');
    expect(r?.path).toBe('/api/projects/:projectId/rules/prompt-preview');
  });
  it('projects.list takes a page query and answers with a page envelope', () => {
    const r = flattenRoutes(routes)['projects.list'];
    expect(r?.query?.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(r?.query?.safeParse({ pageSize: 101 }).success).toBe(false);
    const envelope = { items: [], page: 1, pageSize: 20, total: 0 };
    expect(r?.response.safeParse(envelope).success).toBe(true);
    expect(r?.response.safeParse([]).success).toBe(false);
  });
  it('registers the onboarding routes with their methods and paths', () => {
    const flat = flattenRoutes(routes);
    expect(flat['me.listInvitations']).toMatchObject({ method: 'GET', path: '/api/me/invitations' });
    expect(flat['me.getInvitation']).toMatchObject({ method: 'GET', path: '/api/me/invitations/:invitationId' });
    expect(flat['me.acceptInvitation']).toMatchObject({
      method: 'POST',
      path: '/api/me/invitations/:invitationId/accept',
    });
    expect(flat['me.declineInvitation']).toMatchObject({
      method: 'POST',
      path: '/api/me/invitations/:invitationId/decline',
    });
    expect(flat['invitations.resend']).toMatchObject({
      method: 'POST',
      path: '/api/orgs/:orgId/invitations/:invitationId/resend',
    });
    expect(flat['platform.resendInvitation']).toMatchObject({
      method: 'POST',
      path: '/api/platform/orgs/:orgId/invitations/:invitationId/resend',
    });
    expect(flat['members.updateRole']).toMatchObject({ method: 'PUT', path: '/api/orgs/:orgId/members/:userId/role' });
    expect(flat['members.remove']).toMatchObject({ method: 'DELETE', path: '/api/orgs/:orgId/members/:userId' });
    expect(flat['orgs.update']).toMatchObject({ method: 'PATCH', path: '/api/orgs/:orgId' });
    expect(flat['projectMembers.list']).toMatchObject({ method: 'GET', path: '/api/projects/:projectId/members' });
    expect(flat['projectMembers.add']).toMatchObject({ method: 'POST', path: '/api/projects/:projectId/members' });
    expect(flat['projectMembers.setRole']).toMatchObject({
      method: 'PUT',
      path: '/api/projects/:projectId/members/:userId/role',
    });
    expect(flat['projectMembers.remove']).toMatchObject({
      method: 'DELETE',
      path: '/api/projects/:projectId/members/:userId',
    });
    expect(flat['projects.audit']).toMatchObject({ method: 'GET', path: '/api/projects/:projectId/audit' });
    expect(flat['audit.list']).toMatchObject({ method: 'GET', path: '/api/orgs/:orgId/audit' });
    expect(flat['orgs.checklist']).toMatchObject({ method: 'GET', path: '/api/orgs/:orgId/checklist' });
  });
  it('invitation lists default to pending', () => {
    expect(routes.invitations.list.query.parse({}).status).toBe('pending');
    expect(routes.platform.listInvitations.query.parse({}).status).toBe('pending');
  });
  it('event and terminal routes keep an optional orgId query', () => {
    const P = '00000000-0000-4000-8000-000000000001';
    expect(routes.runs.events.query.parse({ orgId: P })).toMatchObject({ orgId: P });
    expect(routes.projects.events.query.parse({ orgId: P })).toMatchObject({ orgId: P });
    expect(routes.setupTests.events.query.parse({ orgId: P })).toMatchObject({ orgId: P });
    expect(routes.runs.terminal.query.parse({ orgId: P })).toMatchObject({ orgId: P });
    expect(routes.setupTests.terminal.query.parse({})).toEqual({});
  });
});
