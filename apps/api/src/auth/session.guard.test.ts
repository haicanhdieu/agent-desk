import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@agentdesk/db';
import type { Config } from '../config/config.module';

const checkTenantAccess = vi.hoisted(() => vi.fn());
vi.mock('../access/check-access', () => ({ checkTenantAccess, isOrgMember: vi.fn() }));

import type { Auth } from './auth';
import { SessionGuard } from './session.guard';

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
  const guard = new SessionGuard(
    auth as unknown as Auth,
    {} as Db,
    { PLATFORM_ADMIN_EMAILS: [] } as unknown as Config,
    logger as never,
  );
  const req = {
    id: 'req-1',
    url: `/api/runs/abc/cancel`,
    method: 'POST',
    headers: {},
    params: { runId: 'abc' },
    routeOptions: { url: '/api/runs/:runId/cancel' },
  };
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { guard, logger, context };
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
