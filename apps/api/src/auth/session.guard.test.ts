import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@agentdesk/db';

const checkTenantAccess = vi.hoisted(() => vi.fn());
vi.mock('../access/check-access', () => ({ checkTenantAccess, isOrgMember: vi.fn() }));
const isPlatformAdmin = vi.hoisted(() => vi.fn());
vi.mock('../access/platform-admin', () => ({ isPlatformAdmin }));

import type { FastifyRequest } from 'fastify';
import { OrgMismatchException, requestedOrgId } from '../common/org-mismatch';
import type { Auth } from './auth';
import { SessionGuard, isPublicPath } from './session.guard';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';

function setup() {
  const logger = { info: vi.fn(), warn: vi.fn() };
  const auth = {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1', email: 'u@x.io', emailVerified: true },
        session: { activeOrganizationId: ORG_ID },
      }),
    },
  };
  const guard = new SessionGuard(auth as unknown as Auth, {} as Db, logger as never);
  const req = {
    id: 'req-1',
    url: `/api/runs/abc/cancel`,
    method: 'POST',
    headers: {},
    params: { runId: 'abc' },
    routeOptions: { url: '/api/runs/:runId/cancel' },
  };
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { guard, logger, context, auth, req };
}

describe('SessionGuard deny log', () => {
  beforeEach(() => checkTenantAccess.mockReset());

  it('includes the projectId when the refused target has one', async () => {
    checkTenantAccess.mockResolvedValue({
      ok: false,
      status: 403,
      reason: 'permission-on-target',
      permission: 'run:cancel',
      projectId: PROJECT_ID,
    });
    const { guard, logger, context } = setup();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        userId: 'user-1',
        routeKey: 'runs.cancel',
        permission: 'run:cancel',
        projectId: PROJECT_ID,
      }),
      'access denied',
    );
  });

  it('leaves projectId out when the refusal has no target', async () => {
    checkTenantAccess.mockResolvedValue({ ok: false, status: 403, reason: 'permission', permission: 'run:cancel' });
    const { guard, logger, context } = setup();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    const [fields] = logger.info.mock.calls[0] ?? [];
    expect(fields).not.toHaveProperty('projectId');
  });
});

describe('SessionGuard platform routes', () => {
  it('a platform route rejects, and never passes, when the resolver throws', async () => {
    isPlatformAdmin.mockReset();
    isPlatformAdmin.mockRejectedValue(new Error('db down'));
    const { guard, req, context } = setup();
    req.method = 'GET';
    req.url = '/api/platform/orgs';
    req.routeOptions = { url: '/api/platform/orgs' };
    await expect(guard.canActivate(context)).rejects.toThrow('db down');
    expect(req).not.toHaveProperty('platformAdmin');
  });
});

describe('SessionGuard public paths', () => {
  it('decides from the matched route, so a percent-encoded /api url still needs a session', async () => {
    const { guard, auth } = setup();
    auth.api.getSession.mockResolvedValue(null);
    const req = {
      id: 'r',
      url: '/%61pi/platform/orgs',
      method: 'GET',
      headers: {},
      routeOptions: { url: '/api/platform/orgs' },
    };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([[''], [undefined]])(
    'fails closed when the matched route pattern is missing (%s) on an /api url',
    async (pattern) => {
      const { guard, auth } = setup();
      auth.api.getSession.mockResolvedValue(null);
      const req = { id: 'r', url: '/api/projects', method: 'GET', headers: {}, routeOptions: { url: pattern } };
      const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it.each([
    ['/api/platform/orgs', false],
    ['/dev/fake/tickets', false],
    ['/api/docs', true],
    ['/api/docs/json', true],
    ['/healthz', true],
    ['/webhooks/:provider', true],
    ['/auth/*', true],
  ])('isPublicPath(%s) is %s', (path, expected) => {
    expect(isPublicPath(path)).toBe(expected);
  });
});

describe('requestedOrgId', () => {
  const req = (headers: Record<string, unknown>, query?: unknown) => ({ headers, query }) as unknown as FastifyRequest;

  it('prefers the x-org-id header over the orgId query param', () => {
    expect(requestedOrgId(req({ 'x-org-id': 'from-header' }, { orgId: 'from-query' }))).toBe('from-header');
  });
  it('falls back to the query param when there is no header', () => {
    expect(requestedOrgId(req({}, { orgId: 'from-query' }))).toBe('from-query');
  });
  it('ignores an empty header and an empty query value', () => {
    expect(requestedOrgId(req({ 'x-org-id': '' }, { orgId: '' }))).toBeUndefined();
    expect(requestedOrgId(req({ 'x-org-id': '' }, { orgId: 'q' }))).toBe('q');
  });
  it('ignores arrays of non-strings and other non-string values', () => {
    expect(requestedOrgId(req({ 'x-org-id': [1, 2] }, { orgId: [{}, 3] }))).toBeUndefined();
    expect(requestedOrgId(req({ 'x-org-id': 5 }, { orgId: { a: 1 } }))).toBeUndefined();
    expect(requestedOrgId(req({}, null))).toBeUndefined();
  });
  it('takes the first string of an array', () => {
    expect(requestedOrgId(req({}, { orgId: ['a', 'b'] }))).toBe('a');
  });
});

describe('SessionGuard org check and user routes', () => {
  beforeEach(() => checkTenantAccess.mockReset());

  const withHeader = (ctx: ReturnType<typeof setup>, headers: Record<string, string>, over: object = {}) => {
    const req = ctx.context.switchToHttp().getRequest<Record<string, unknown>>();
    Object.assign(req, { headers, ...over });
    return req;
  };

  it('throws OrgMismatchException and logs only ids when the header is not the active org', async () => {
    const ctx = setup();
    withHeader(ctx, { 'x-org-id': 'other-org' });
    await expect(ctx.guard.canActivate(ctx.context)).rejects.toBeInstanceOf(OrgMismatchException);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      { requestId: 'req-1', userId: 'user-1', sessionOrgId: ORG_ID, headerOrgId: 'other-org' },
      'org mismatch',
    );
    expect(checkTenantAccess).not.toHaveBeenCalled();
  });

  it('treats a header with no active org in the session as a mismatch', async () => {
    const ctx = setup();
    ctx.auth.api.getSession.mockResolvedValue({
      user: { id: 'user-1', email: 'u@x.io', emailVerified: true },
      session: { activeOrganizationId: null },
    });
    withHeader(ctx, { 'x-org-id': ORG_ID });
    await expect(ctx.guard.canActivate(ctx.context)).rejects.toBeInstanceOf(OrgMismatchException);
  });

  it('passes a user route with the session user set, ignoring a mismatching header and the missing org', async () => {
    const ctx = setup();
    ctx.auth.api.getSession.mockResolvedValue({
      user: { id: 'user-1', email: 'u@x.io', emailVerified: true },
      session: { activeOrganizationId: null },
    });
    const req = withHeader(
      ctx,
      { 'x-org-id': 'other-org' },
      { method: 'GET', url: '/api/me/invitations', routeOptions: { url: '/api/me/invitations' } },
    );
    await expect(ctx.guard.canActivate(ctx.context)).resolves.toBe(true);
    expect(req['sessionUser']).toEqual({ userId: 'user-1', email: 'u@x.io', emailVerified: true });
    expect(req['orgContext']).toBeUndefined();
    expect(checkTenantAccess).not.toHaveBeenCalled();
  });
});
