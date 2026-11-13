import { describe, expect, it } from 'vitest';
import {
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
    expect(Object.keys(flat)).toHaveLength(39);
  });
  it('rejects timeoutSeconds above 3300', () => {
    expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 3301 }).success).toBe(false);
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
  it('PutAgentRequest accepts timeoutSeconds 3300 and rejects 3301', () => {
    expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 3300 }).success).toBe(true);
    expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 3301 }).success).toBe(false);
  });
  it('RunListQuery.limit defaults to 50', () => {
    expect(RunListQuery.parse({}).limit).toBe(50);
  });
});
