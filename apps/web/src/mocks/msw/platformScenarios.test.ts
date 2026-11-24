// The contracts package's own client is what these tests drive; the restriction is for app code.
import { ORG_SUSPENDED_PROBLEM_TYPE, PAGE_SIZE_DEFAULT } from '@agentdesk/contracts';
import { ApiError, createApi } from '@agentdesk/contracts/client';
import { describe, expect, it } from 'vitest';
import { ids } from '../dto/ids';
import { mockDb } from './db';
import { getPlatformOrg } from './platformOrgs';
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
      'ownAdminRow',
      'unverifiedAccount',
      'manyOrgs',
      'suspendedMember',
      'suspendedPlatformAdmin',
      'platformOrgEdit',
      'platformOrgEditSuspended',
      'manyAudit',
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

  it('platformAdminOrgs: a slug that the directory lists is taken for a new org', async () => {
    scenarios.platform('platformAdminOrgs');
    const err = await rejection(api.platform.createOrg({ body: { name: 'Acme Two', slug: 'acme' } }));
    expect(err.status).toBe(409);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/slug' })]);
    expect((await api.platform.listOrgs({ query: {} })).items.filter((o) => o.slug === 'acme')).toHaveLength(1);
  });

  it('platformOrgEdit: Acme (acme) and Beta (beta) in the directory, both active', async () => {
    scenarios.platform('platformOrgEdit');
    const page = await api.platform.listOrgs({ query: {} });
    expect(page.items.map((o) => [o.name, o.slug, o.status]).sort()).toEqual([
      ['Acme', 'acme', 'active'],
      ['Beta', 'beta', 'active'],
    ]);
  });

  it('platformOrgEditSuspended: Acme is suspended with a reason, Beta stays active', async () => {
    scenarios.platform('platformOrgEditSuspended');
    const page = await api.platform.listOrgs({ query: {} });
    expect(page.items.map((o) => [o.slug, o.status]).sort()).toEqual([
      ['acme', 'suspended'],
      ['beta', 'active'],
    ]);
    const acme = page.items.find((o) => o.slug === 'acme');
    expect(acme?.suspendedAt).not.toBeNull();
    expect(getPlatformOrg(acme?.id ?? '').suspension?.reason).toBe('Billing hold');
  });

  it('platformEmpty: lists no org', async () => {
    scenarios.platform('platformEmpty');
    expect((await api.platform.listOrgs({ query: {} })).items).toEqual([]);
  });

  it('manyOrgs: more organizations than a page, newest first, searchable', async () => {
    scenarios.platform('manyOrgs');
    const first = await api.platform.listOrgs({ query: {} });
    const second = await api.platform.listOrgs({ query: { page: 2 } });
    expect(first.total).toBeGreaterThan(PAGE_SIZE_DEFAULT);
    expect(first.items).toHaveLength(PAGE_SIZE_DEFAULT);
    expect(second.items.length).toBeGreaterThan(0);
    const oldestOnFirst = first.items[first.items.length - 1]?.createdAt ?? '';
    expect(second.items.every((o) => o.createdAt < oldestOnFirst)).toBe(true);
    const found = await api.platform.listOrgs({ query: { q: 'many org' } });
    expect(found.total).toBe(first.total);
  });

  it('manyAudit: more audit entries than a page, newest first, the oldest on page 2', async () => {
    scenarios.platform('manyAudit');
    const first = await api.platform.listAudit({ query: {} });
    const second = await api.platform.listAudit({ query: { page: 2 } });
    expect(first.total).toBe(25);
    expect(first.items).toHaveLength(PAGE_SIZE_DEFAULT);
    expect(second.items).toHaveLength(5);
    const oldestOnFirst = first.items[first.items.length - 1]?.at ?? '';
    expect(second.items.every((e) => e.at < oldestOnFirst)).toBe(true);
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

  it('ownAdminRow: the signed-in user is a working admin row next to another working admin', async () => {
    scenarios.platform('ownAdminRow');
    const me = mockDb.state.users[0];
    const items = (await api.platform.listAdmins({ query: {} })).items;
    expect(items.filter((a) => a.userId !== null).length).toBeGreaterThanOrEqual(2);
    expect(items.find((a) => a.userId === me?.id)?.lastWorkingAdmin).toBe(false);
    expect(items.some((a) => a.userId !== null && a.userId !== me?.id)).toBe(true);
  });

  it('unverifiedAccount: an unverified account has no admin row', async () => {
    scenarios.platform('unverifiedAccount');
    const account = mockDb.state.users.find((u) => u.email === 'unverified@example.test');
    expect(account?.emailVerified).toBe(false);
    const items = (await api.platform.listAdmins({ query: {} })).items;
    expect(items.some((a) => a.email === 'unverified@example.test')).toBe(false);
  });

  describe('suspended orgs', () => {
    // A client that pins every request to the active org, as the web app does.
    const pinned = createApi({
      baseUrl: 'http://localhost:3000',
      parse: true,
      orgId: () => mockDb.auth.activeOrganizationId ?? undefined,
    });

    it('suspendedMember: the suspended active org answers 403 org-suspended on me.access and a project list, with no reason', async () => {
      scenarios.platform('suspendedMember');
      for (const call of [() => pinned.me.access(), () => pinned.projects.list({ query: {} })]) {
        const err = await rejection(call());
        expect(err.status).toBe(403);
        expect(err.type.endsWith(`:${ORG_SUSPENDED_PROBLEM_TYPE}`)).toBe(true);
        expect(JSON.stringify(err)).not.toContain('Billing hold');
        expect(err.message).not.toContain('Billing hold');
      }
    });

    it('suspendedMember: the other org answers 200 once it is active', async () => {
      scenarios.platform('suspendedMember');
      mockDb.setActiveOrg(ids.org.acme);
      await expect(pinned.me.access()).resolves.toBeTruthy();
      await expect(pinned.projects.list({ query: {} })).resolves.toBeTruthy();
    });

    it('suspendedMember: the org list marks the suspended org and keeps the reason out', async () => {
      scenarios.platform('suspendedMember');
      const res = await fetch('http://localhost:3000/auth/organization/list');
      const text = await res.text();
      const rows = JSON.parse(text) as { id: string; status?: string }[];
      expect(rows.find((o) => o.id === ids.org.alice)?.status).toBe('suspended');
      expect(rows.find((o) => o.id === ids.org.acme)?.status).toBe('active');
      expect(text).not.toContain('Billing hold');
      expect(getPlatformOrg(ids.org.alice).suspension?.reason).toBe('Billing hold');
    });

    it('suspendedMember: a non-member gets the plain 403', async () => {
      scenarios.platform('suspendedMember');
      mockDb.state.memberships = mockDb.state.memberships.filter((m) => m.orgId !== ids.org.alice);
      const err = await rejection(pinned.me.access());
      expect(err.status).toBe(403);
      expect(err.type).not.toMatch(/org-suspended/);
    });

    it('suspendedPlatformAdmin: is a platform admin and reads the suspended org', async () => {
      scenarios.platform('suspendedPlatformAdmin');
      expect((await pinned.me.platform()).platformAdmin).toBe(true);
      expect((await rejection(pinned.me.access())).type).toMatch(/:org-suspended$/);
      expect((await pinned.platform.getOrg({ params: { orgId: ids.org.alice } })).status).toBe('suspended');
    });

    it('suspendedMember: the user routes and set-active stay allowed for the suspended org', async () => {
      scenarios.platform('suspendedMember');
      await expect(pinned.me.platform()).resolves.toBeTruthy();
      await expect(pinned.me.listInvitations({ query: {} })).resolves.toBeTruthy();
      const res = await fetch('http://localhost:3000/auth/organization/set-active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: ids.org.acme }),
      });
      expect(res.status).toBe(200);
    });

    it('suspendedPlatformAdmin: a platform admin who is not a member gets the plain 403 on an org route', async () => {
      scenarios.platform('suspendedPlatformAdmin');
      mockDb.state.memberships = mockDb.state.memberships.filter((m) => m.orgId !== ids.org.alice);
      const err = await rejection(pinned.projects.list({ query: {} }));
      expect(err.status).toBe(403);
      expect(err.type).not.toMatch(/org-suspended/);
      expect((await pinned.me.platform()).platformAdmin).toBe(true);
    });

    it('suspendedMember: the stream routes of the suspended org answer 403 org-suspended, not data', async () => {
      scenarios.platform('suspendedMember');
      const run = mockDb.state.runs.find((r) =>
        mockDb.state.projects.some((p) => p.id === r.projectId && p.orgId === ids.org.alice),
      );
      const project = mockDb.state.projects.find((p) => p.orgId === ids.org.alice);
      if (!run || !project) throw new Error('seed has no run or project in the suspended org');
      for (const path of [
        `/api/runs/${run.id}/events`,
        `/api/runs/${run.id}/terminal`,
        `/api/projects/${project.id}/events`,
      ]) {
        const res = await fetch(`http://localhost:3000${path}`, { headers: { 'x-org-id': ids.org.alice } });
        expect(res.status, path).toBe(403);
        expect(((await res.json()) as { type: string }).type, path).toMatch(/:org-suspended$/);
      }
    });

    it('reactivating through the platform route lets the member in again', async () => {
      scenarios.platform('suspendedPlatformAdmin');
      await pinned.platform.reactivateOrg({ params: { orgId: ids.org.alice }, body: { reason: 'Paid' } });
      await expect(pinned.me.access()).resolves.toBeTruthy();
    });
  });
});
