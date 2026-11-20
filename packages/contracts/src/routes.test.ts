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
  it('flattenRoutes uses dotted keys', () => {
    const flat = flattenRoutes(routes);
    expect(Object.keys(flat)).toContain('runs.list');
    expect(Object.keys(flat)).toContain('agents.putCredential');
    expect(flat['runs.resume']).toMatchObject({ method: 'POST', path: '/api/runs/:runId/resume' });
    expect(flat['runs.stop']).toMatchObject({ method: 'POST', path: '/api/runs/:runId/stop' });
    expect(flat['runs.transcript']).toMatchObject({ method: 'GET', path: '/api/runs/:runId/transcript' });
    expect(flat['projects.pollNow']).toMatchObject({
      method: 'POST',
      path: '/api/projects/:projectId/connection/poll',
    });
    expect(Object.keys(flat)).toHaveLength(48);
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
  it('RunListQuery.limit defaults to 50', () => {
    expect(RunListQuery.parse({}).limit).toBe(50);
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
});
