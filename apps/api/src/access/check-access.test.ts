import { describe, expect, it } from 'vitest';
import type { RouteAccess } from '@agentdesk/contracts';
import type { Db } from '@agentdesk/db';
import { checkTenantAccess, orgMembership } from './check-access';

/** A Db whose only query, the membership lookup, returns `rows`; any other use throws. */
const dbWithMembers = (rows: { id: string; status?: string }[]): Db => {
  const where = () => ({ limit: async () => rows });
  return {
    orm: { select: () => ({ from: () => ({ innerJoin: () => ({ where }), where }) }) },
  } as unknown as Db;
};

const who = { userId: 'u', orgId: 'o' };

describe('checkTenantAccess on a user route', () => {
  it('refuses an org member with 403 user-route, before any permission lookup', async () => {
    const res = await checkTenantAccess(dbWithMembers([{ id: 'm' }]), who, { scope: 'user' }, {});
    expect(res).toEqual({ ok: false, status: 403, reason: 'user-route' });
  });

  it('refuses a non-member with 403 not-a-member', async () => {
    const res = await checkTenantAccess(dbWithMembers([]), who, { scope: 'user' }, {});
    expect(res).toEqual({ ok: false, status: 403, reason: 'not-a-member' });
  });
});

describe('orgMembership', () => {
  it('is none for a non-member, active or suspended for a member by the org status', async () => {
    expect(await orgMembership(dbWithMembers([]), who)).toBe('none');
    expect(await orgMembership(dbWithMembers([{ id: 'm', status: 'active' }]), who)).toBe('active');
    expect(await orgMembership(dbWithMembers([{ id: 'm', status: 'suspended' }]), who)).toBe('suspended');
  });
});

describe('checkTenantAccess on a suspended org', () => {
  const suspended = dbWithMembers([{ id: 'm', status: 'suspended' }]);
  const entries: RouteAccess[] = [
    { scope: 'org', permission: 'project:read' },
    { scope: 'self' },
    { scope: 'project', permission: 'run:cancel', param: 'runId' },
  ];

  it.each(entries)('refuses a member with 403 org-suspended on a %o route, before any permission lookup', async (e) => {
    const res = await checkTenantAccess(suspended, who, e, {});
    expect(res).toEqual({ ok: false, status: 403, reason: 'org-suspended' });
  });

  it('answers a non-member the plain not-a-member, never the suspension', async () => {
    const res = await checkTenantAccess(dbWithMembers([]), who, { scope: 'self' }, {});
    expect(res).toEqual({ ok: false, status: 403, reason: 'not-a-member' });
  });
});
