// The contracts package's own client is what these tests drive; the restriction is for app code.
import { PAGE_SIZE_DEFAULT } from '@agentdesk/contracts';
import { ApiError, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { mockDb } from './db';
import { platformOrgDtoFixtures } from '../dto/platform';
import { PLATFORM_SCENARIO_KEY, PLATFORM_SCENARIOS, parsePlatformScenario } from './platformScenarios';
import { scenarios } from './scenarios';

const api = createApi({ baseUrl: 'http://localhost:3000', parse: true });

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

describe('platform scenarios', () => {
  it('names the key and every scenario', () => {
    expect(PLATFORM_SCENARIO_KEY).toBe('agentdesk.mock.platform');
    expect([...PLATFORM_SCENARIOS]).toEqual([
      'platformAdminOrgs',
      'platformAdminNoOrg',
      'ownerNoPlatform',
      'lastAdmin',
      'revoke409',
      'platformEmpty',
      'lastAdminPage1',
    ]);
  });

  it('parsePlatformScenario rejects unknown names', () => {
    expect(parsePlatformScenario('lastAdmin')).toBe('lastAdmin');
    expect(parsePlatformScenario('nope')).toBeUndefined();
    expect(parsePlatformScenario(null)).toBeUndefined();
  });

  it('platformAdminOrgs: a platform admin who owns one org', async () => {
    scenarios.platform('platformAdminOrgs');
    expect((await api.me.platform()).platformAdmin).toBe(true);
    const access = await api.me.access();
    expect(access.platformAdmin).toBe(true);
    expect(mockDb.state.memberships).toHaveLength(1);
    expect(mockDb.state.memberships[0]?.roleKey).toBe('owner');
  });

  it('platformAdminOrgs: lists the directory fixtures', async () => {
    scenarios.platform('platformAdminOrgs');
    const page = await api.platform.listOrgs({ query: {} });
    const newestFirst = [...platformOrgDtoFixtures].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(page.items.map((o) => o.id)).toEqual(newestFirst.map((o) => o.id));
  });

  it('platformEmpty: lists no org', async () => {
    scenarios.platform('platformEmpty');
    expect((await api.platform.listOrgs({ query: {} })).items).toEqual([]);
  });

  it('platformAdminNoOrg: a platform admin with no org', async () => {
    scenarios.platform('platformAdminNoOrg');
    expect((await api.me.platform()).platformAdmin).toBe(true);
    expect(mockDb.state.memberships).toHaveLength(0);
  });

  it('ownerNoPlatform: an owner who is not a platform admin', async () => {
    scenarios.platform('ownerNoPlatform');
    expect((await api.me.platform()).platformAdmin).toBe(false);
    expect(mockDb.state.memberships[0]?.roleKey).toBe('owner');
  });

  it('lastAdmin: one working admin on page 2 of three pages', async () => {
    scenarios.platform('lastAdmin');
    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await api.platform.listAdmins({ query: { page } }));
    expect(pages[0]?.items).toHaveLength(PAGE_SIZE_DEFAULT);
    expect(pages[1]?.items).toHaveLength(PAGE_SIZE_DEFAULT);
    expect(pages[2]?.items.length).toBeGreaterThan(0);
    const flagged = pages.map((p) => p?.items.filter((a) => a.lastWorkingAdmin).length);
    expect(flagged).toEqual([0, 1, 0]);
    expect(pages[1]?.items.find((a) => a.lastWorkingAdmin)?.userId).not.toBeNull();
    expect(pages.flatMap((p) => p?.items ?? []).filter((a) => a.userId !== null)).toHaveLength(1);
  });

  it('lastAdminPage1: the scenario name puts the working admin on page 1 of three pages', async () => {
    scenarios.platform('lastAdminPage1');
    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await api.platform.listAdmins({ query: { page } }));
    expect(pages.map((p) => p?.items.filter((a) => a.lastWorkingAdmin).length)).toEqual([1, 0, 0]);
    expect(pages[1]?.items).toHaveLength(PAGE_SIZE_DEFAULT);
  });

  it('revoke409: revoking an admin answers 409 with a problem title', async () => {
    scenarios.platform('revoke409');
    const first = (await api.platform.listAdmins({ query: {} })).items[0];
    if (!first) throw new Error('no admin seeded');
    const err = await rejection(api.platform.revokeAdmin({ params: { adminId: first.id } }));
    expect(err.status).toBe(409);
    expect(err.title).toBeTruthy();
  });

  it('platformEmpty: lists no admins', async () => {
    scenarios.platform('platformEmpty');
    expect((await api.platform.listAdmins({ query: {} })).items).toEqual([]);
    expect((await api.me.platform()).platformAdmin).toBe(true);
  });
});
