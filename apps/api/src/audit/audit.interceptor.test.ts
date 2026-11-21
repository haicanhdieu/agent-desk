import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@agentdesk/db';
import { AuditInterceptor, describeRequest } from './audit.interceptor';

const withOrg = vi.hoisted(() => vi.fn());
vi.mock('@agentdesk/db', async (orig) => ({ ...(await orig<typeof import('@agentdesk/db')>()), withOrg }));

describe('describeRequest', () => {
  it('names a listed route by its route-table key and captures the first param', () => {
    expect(describeRequest('PATCH', '/api/projects/p-1')).toEqual({
      action: 'PATCH projects.update',
      targetType: 'projects',
      targetId: 'p-1',
    });
  });

  it('falls back to "METHOD path" with no target id for a route not in the table', () => {
    expect(describeRequest('POST', '/api/not-a-route/x')).toEqual({
      action: 'POST /api/not-a-route/x',
      targetType: 'not-a-route',
      targetId: null,
    });
  });
});

async function auditedValues(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  withOrg.mockReset().mockResolvedValue(undefined);
  const full = { orgContext: { orgId: 'org-1', userId: 'u-1' }, body: {}, ...req };
  const context = { switchToHttp: () => ({ getRequest: () => full }) } as unknown as ExecutionContext;
  const next = { handle: () => of('done') } as CallHandler;
  await lastValueFrom(new AuditInterceptor({} as Db).intercept(context, next));
  expect(withOrg).toHaveBeenCalledTimes(1);
  const run = withOrg.mock.calls[0]?.[2] as (tx: unknown) => unknown;
  const values = vi.fn();
  run({ insert: () => ({ values }) });
  return values.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('AuditInterceptor', () => {
  it('audits a mutation sent to a percent-encoded /api path, with the route action and the param as target', async () => {
    const row = await auditedValues({
      method: 'PATCH',
      url: '/%61pi/projects/p-1',
      routeOptions: { url: '/api/projects/:projectId' },
      params: { projectId: 'p-1' },
    });
    expect(row).toMatchObject({ action: 'PATCH projects.update', targetType: 'projects', targetId: 'p-1' });
  });

  it('never takes the action or target from url text such as a fragment with control characters', async () => {
    const url = '/api/runs/r-1/cancel#%0Aforged%E2%80%AE';
    const row = await auditedValues({
      method: 'POST',
      url,
      routeOptions: { url: '/api/runs/:runId/cancel' },
      params: { runId: 'r-1' },
    });
    expect(row).toMatchObject({ action: 'POST runs.cancel', targetType: 'runs', targetId: 'r-1' });
    const text = [row.action, row.targetType, row.targetId].join('');
    expect([...text].some((c) => c < ' ' || c === '\u202e' || c === '#')).toBe(false);
    expect(text).not.toContain('forged');
  });

  it('falls back to the route pattern, not the request path, for a route outside the table', async () => {
    const row = await auditedValues({
      method: 'POST',
      url: '/api/odd/%0Ax',
      routeOptions: { url: '/api/odd/:id' },
      params: { id: '\nx' },
    });
    expect(row).toMatchObject({ action: 'POST /api/odd/:id', targetType: 'odd', targetId: null });
  });
});
