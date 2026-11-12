import { describe, expect, it } from 'vitest';
import { CreateRuleRequest, PutAgentRequest, RunListQuery, UpdateProjectRequest, flattenRoutes, routes } from './index';

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
    expect(Object.keys(flat)).toHaveLength(30);
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

describe('contract boundaries', () => {
  it('PutAgentRequest accepts timeoutSeconds 3300 and rejects 3301', () => {
    expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 3300 }).success).toBe(true);
    expect(PutAgentRequest.safeParse({ model: 'sonnet', timeoutSeconds: 3301 }).success).toBe(false);
  });
  it('RunListQuery.limit defaults to 50', () => {
    expect(RunListQuery.parse({}).limit).toBe(50);
  });
});
