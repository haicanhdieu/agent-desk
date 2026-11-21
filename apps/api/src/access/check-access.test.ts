import { describe, expect, it } from 'vitest';
import type { Db } from '@agentdesk/db';
import { checkTenantAccess } from './check-access';

/** A Db whose only query, the membership lookup, returns `rows`; any other use throws. */
const dbWithMembers = (rows: { id: string }[]): Db =>
  ({
    orm: { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) },
  }) as unknown as Db;

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
