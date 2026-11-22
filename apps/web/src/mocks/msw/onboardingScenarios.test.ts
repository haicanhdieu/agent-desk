import { holdsAnywhere, type InvitationDto } from '@agentdesk/contracts';
// The contracts package's own client is what these tests drive; the restriction is for app code.
import { ApiError, createApi } from '@agentdesk/contracts/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toAccess } from '@/features/access/queries';
import { roleFixtures } from '../dto/access';
import { ids } from '../dto/ids';
import { INVITATIONS_MOCK_NOW } from '../dto/invitations';
import { NO_ROLE, mockDb } from './db';
import {
  ONBOARDING_SCENARIO_KEY,
  ONBOARDING_SCENARIOS,
  applyOnboardingScenario,
  parseOnboardingScenario,
  type OnboardingScenario,
} from './onboardingScenarios';
import { scenarios } from './scenarios';

const BASE = 'http://localhost:3000';
const api = createApi({ baseUrl: BASE, parse: true });
const anyOrg = { orgId: ids.created(777) };
const roleId = (key: string): string => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role ${key} missing`);
  return role.id;
};

async function rejection(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error('expected the call to fail');
}

async function userOrgs(): Promise<string[]> {
  const res = await fetch(`${BASE}/auth/organization/list`);
  const list = z.array(z.object({ name: z.string() })).parse(await res.json());
  return list.map((o) => o.name);
}

const listed = async (status: InvitationDto['status'] | 'all', pageSize = 100) =>
  (await api.invitations.list({ params: anyOrg, query: { status, pageSize } })).items;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(INVITATIONS_MOCK_NOW));
});
afterEach(() => vi.useRealTimers());

it('the key and every scenario name', () => {
  expect(ONBOARDING_SCENARIO_KEY).toBe('agentdesk.mock.onboarding');
  expect(ONBOARDING_SCENARIOS).toHaveLength(22);
  expect(parseOnboardingScenario('owner')).toBe('owner');
  expect(parseOnboardingScenario('nope')).toBeUndefined();
  expect(parseOnboardingScenario(null)).toBeUndefined();
});

describe.each(ONBOARDING_SCENARIOS)('%s', (name) => {
  it('seeds a signed-in user, and a second apply starts from a clean seed', () => {
    scenarios.onboarding(name);
    const first = JSON.stringify(mockDb.state.memberships);
    scenarios.onboarding(name);
    expect(JSON.stringify(mockDb.state.memberships)).toBe(first);
    expect(mockDb.currentUser()).not.toBeNull();
  });
});

describe('people with no org', () => {
  it('noOrgInvited lists the invitee own pending invitations and keeps the rest out of the list', async () => {
    // The pending ones expire 23 Nov 14:05, so the clock has to be before that for them to be pending.
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
    scenarios.onboarding('noOrgInvited');
    expect(await userOrgs()).toEqual([]);
    expect(mockDb.auth.activeOrganizationId).toBeNull();
    const mine = await api.me.listInvitations({ query: { page: 1, pageSize: 100 } });
    expect(mine.items.map((i) => i.invitedBy)).toEqual([
      { name: 'Ada Lovelace', handle: 'ada' },
      { name: 'Ada Lovelace', handle: 'ada' },
      { name: 'ada', handle: 'ada' },
      null,
    ]);
    expect(new Set(mockDb.state.invitations.map((i) => i.status))).toEqual(
      new Set(['pending', 'expired', 'revoked', 'declined', 'accepted']),
    );
    const expired = mockDb.state.invitations.find((i) => i.status === 'expired');
    expect((await api.me.getInvitation({ params: { invitationId: expired?.id ?? '' } })).status).toBe('expired');
  });

  it('noOrgInvited has an expired invitation whose inviter was deleted, out of the pending list', async () => {
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
    scenarios.onboarding('noOrgInvited');
    const row = mockDb.state.invitations.find((i) => i.status === 'expired' && i.invitedBy === null);
    expect(row?.email).toBe('invitee@x.dev');
    expect((await api.me.getInvitation({ params: { invitationId: row?.id ?? '' } })).status).toBe('expired');
    const mine = await api.me.listInvitations({ query: { page: 1, pageSize: 100 } });
    expect(mine.items.map((i) => i.id)).not.toContain(row?.id);
  });

  it('noOrgInvitedStates has exactly one pending, one expired and one revoked invitation for the invitee', async () => {
    vi.setSystemTime(new Date('2026-11-21T12:00:00.000Z'));
    scenarios.onboarding('noOrgInvitedStates');
    expect(await userOrgs()).toEqual([]);
    expect(mockDb.currentUser()?.email).toBe('invitee@x.dev');
    const rows = mockDb.state.invitations;
    expect(rows.map((i) => i.status).sort()).toEqual(['expired', 'pending', 'revoked']);
    expect(new Set(rows.map((i) => i.email))).toEqual(new Set(['invitee@x.dev']));
    const mine = await api.me.listInvitations({ query: { page: 1, pageSize: 100 } });
    expect(mine.items.map((i) => i.id)).toEqual([rows.find((i) => i.status === 'pending')?.id]);
    for (const status of ['revoked', 'expired'] as const) {
      const row = rows.find((i) => i.status === status);
      expect((await api.me.getInvitation({ params: { invitationId: row?.id ?? '' } })).status).toBe(status);
    }
  });

  it('noOrgInvited rows were created before they expire', () => {
    scenarios.onboarding('noOrgInvited');
    for (const i of mockDb.state.invitations) {
      expect(Date.parse(i.createdAt)).toBeLessThan(Date.parse(i.expiresAt));
    }
  });

  it('noOrgUninvited has no org, no invitation and is no platform admin', async () => {
    scenarios.onboarding('noOrgUninvited');
    expect(await userOrgs()).toEqual([]);
    expect((await api.me.listInvitations({ query: { page: 1, pageSize: 100 } })).items).toEqual([]);
    expect((await api.me.access()).platformAdmin).toBe(false);
  });

  it('platformAdminNoOrg lists no org and me.access says platformAdmin', async () => {
    scenarios.onboarding('platformAdminNoOrg');
    expect(await userOrgs()).toEqual([]);
    expect(await api.me.access()).toMatchObject({ platformAdmin: true, assignments: [] });
    // The seed org `acme` exists (slug taken) although the admin is not in it.
    const taken = await rejection(api.platform.createOrg({ body: { name: 'X', slug: 'acme' } }));
    expect(taken.status).toBe(409);
  });

  it('platformAdminOneOrg is a platform admin in one org', async () => {
    scenarios.onboarding('platformAdminOneOrg');
    expect(await userOrgs()).toEqual(['Alice']);
    expect((await api.me.access()).platformAdmin).toBe(true);
  });
});

describe('org counts', () => {
  it('singleOrg has one org and no platform admin', async () => {
    scenarios.onboarding('singleOrg');
    expect(await userOrgs()).toEqual(['Alice']);
    expect((await api.me.access()).platformAdmin).toBe(false);
  });

  it.each(['twoOrgs', 'twoOrgsSlowSwitch', 'twoOrgsNoRoleInSecond'] as const)('%s has two orgs', async (name) => {
    scenarios.onboarding(name);
    expect((await userOrgs()).sort()).toEqual(['Acme', 'Alice']);
    expect(mockDb.state.setActiveDelayMs).toBe(name === 'twoOrgsSlowSwitch' ? 1500 : 0);
    expect(mockDb.state.orgs.some((o) => o.slug === 'other')).toBe(true);
    expect(mockDb.orgsOf(mockDb.currentUser()?.id ?? '').some((o) => o.slug === 'other')).toBe(false);
  });

  it('twoOrgsNoRoleInSecond: projects answer in the first org and 403 in the second', async () => {
    scenarios.onboarding('twoOrgsNoRoleInSecond');
    expect((await api.projects.list({ query: { page: 1, pageSize: 20 } })).items.length).toBeGreaterThan(0);
    mockDb.setActiveOrg(ids.org.acme);
    expect((await rejection(api.projects.list({ query: { page: 1, pageSize: 20 } }))).status).toBe(403);
    expect((await api.me.access()).assignments).toEqual([]);
  });

  it('twoOrgsNoRoleInSecond seats the member with the role key the handlers treat as no role', () => {
    scenarios.onboarding('twoOrgsNoRoleInSecond');
    const seat = mockDb.state.memberships.find((m) => m.orgId === ids.org.acme);
    expect(NO_ROLE).toBe('none');
    expect(seat?.roleKey).toBe(NO_ROLE);
  });
});

describe('roles', () => {
  const accessOf = async () => toAccess(await api.me.access());

  it('owner is an Acme owner with an invitation in every status, member@x.dev a member and p@x.dev pending', async () => {
    scenarios.onboarding('owner');
    expect(mockDb.state.orgs.find((o) => o.id === mockDb.auth.activeOrganizationId)?.slug).toBe('acme');
    expect(holdsAnywhere(await accessOf(), 'assignment:create')).toBe(true);
    const rows = await listed('all');
    expect(new Set(rows.map((i) => i.status))).toEqual(
      new Set(['pending', 'accepted', 'declined', 'revoked', 'expired']),
    );
    expect((await listed('pending')).map((i) => i.email)).toContain('p@x.dev');
    const member = mockDb.state.users.find((u) => u.email === 'member@x.dev');
    expect(mockDb.state.memberships.some((m) => m.userId === member?.id && m.orgId === ids.org.acme)).toBe(true);
    // Inviter variants the Invited by column shows.
    expect(rows.map((i) => i.invitedBy)).toContainEqual({ name: 'bob', handle: 'bob' });
    expect(rows.map((i) => i.invitedBy)).toContain(null);
  });

  it('orgAdmin can invite but cannot delete the org', async () => {
    scenarios.onboarding('orgAdmin');
    const access = await api.me.access();
    expect(access.assignments).toHaveLength(1);
    expect(access.assignments[0]).toMatchObject({ roleKey: 'admin', scope: { type: 'org' } });
    const perms = access.assignments[0]?.permissions.map((p) => p.permission) ?? [];
    expect(perms).toContain('assignment:create');
    expect(perms).not.toContain('org:delete');
  });

  it('projectAdmin administers P1 and not P2', async () => {
    scenarios.onboarding('projectAdmin');
    const access = await api.me.access();
    expect(access.assignments.map((a) => [a.roleKey, a.scope])).toEqual([
      ['admin', { type: 'project', projectId: ids.project.invoicerApi }],
    ]);
    const names = (await api.projects.list({ query: { page: 1, pageSize: 20 } })).items.map((p) => p.id);
    expect(names).toContain(ids.project.invoicerApi);
    expect(names).toContain(ids.project.invoicerWeb);
    expect((await rejection(api.orgs.checklist({ params: anyOrg }))).status).toBe(403);
  });

  it.each(['member', 'viewer'] as const)('%s has no assignment:create and no checklist', async (name) => {
    scenarios.onboarding(name);
    const access = await accessOf();
    expect(holdsAnywhere(access, 'assignment:create')).toBe(false);
    expect(access.grants[0]?.roleKey).toBe(name);
    expect((await rejection(api.orgs.checklist({ params: anyOrg }))).status).toBe(403);
    // The rows exist, and the list answers 403 as the API does: a page that shows none checked access.
    expect(mockDb.state.invitations.length).toBeGreaterThan(0);
    expect((await rejection(api.invitations.list({ params: anyOrg }))).status).toBe(403);
  });
});

describe('invitation lists', () => {
  it('invitationsPaged: more pending rows than one page, and other statuses to filter to', async () => {
    scenarios.onboarding('invitationsPaged');
    const page1 = await api.invitations.list({ params: anyOrg });
    expect(page1.items.every((i) => i.status === 'pending')).toBe(true);
    expect(page1.total).toBeGreaterThan(page1.pageSize);
    expect((await listed('accepted')).length).toBeGreaterThan(0);
  });

  it('invitationsExpiry holds rows relative to the fixed clock', async () => {
    scenarios.onboarding('invitationsExpiry');
    const ago = (ms: number) => new Date(Date.parse(INVITATIONS_MOCK_NOW) - ms).toISOString();
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    const expired = await listed('expired');
    expect(expired).toHaveLength(8);
    const byEmail = (email: string) => {
      const row = [...expired, ...mockDb.state.invitations].find((i) => i.email === email);
      if (!row) throw new Error(`row ${email} missing`);
      return row;
    };
    expect(expired.map((i) => i.expiresAt)).toContain(ago(DAY));
    expect(byEmail('expired-2d23h@x.dev').expiresAt).toBe(ago(2 * DAY + 23 * HOUR));
    expect(byEmail('expired-3d@x.dev').expiresAt).toBe(ago(3 * DAY));
    expect(byEmail('expired-3d1h@x.dev').expiresAt).toBe(ago(3 * DAY + HOUR));
    expect(byEmail('expired-5d@x.dev').expiresAt).toBe(ago(5 * DAY));
    // Created 2 days 1 minute ago and never answered: stored pending, expired by the clock.
    const lapsed = mockDb.state.invitations.find((i) => i.createdAt === ago(2 * DAY + MIN));
    expect(lapsed).toMatchObject({ status: 'pending', createdAt: ago(2 * DAY + MIN) });
    expect(expired.map((i) => i.id)).toContain(lapsed?.id);
    // Both rows the owner can open as the invitee carry the owner's own email.
    expect(lapsed?.email).toBe(mockDb.currentUser()?.email);
    // Expires a minute after the clock, in 2 days and in 5 hours.
    const pending = await listed('pending');
    const expiries = pending.map((i) => Date.parse(i.expiresAt) - Date.parse(INVITATIONS_MOCK_NOW));
    expect(expiries).toEqual(expect.arrayContaining([MIN, 2 * DAY, 5 * HOUR]));
    // An expired row and a newer pending one for one email; an expired row whose inviter is gone.
    const dup = mockDb.state.invitations.filter((i) => i.email === 'again@x.dev');
    expect(dup.map((i) => i.status).sort()).toEqual(['expired', 'pending']);
    expect(expired.some((i) => i.invitedBy === null)).toBe(true);
    // One pending row for the owner's own email, with its inviter gone, expiring 3 hours out, in the other org the owner
    // administers: the owner sees it on that org's Invitations page and as the invitee (TC-52.4).
    const own = mockDb.state.invitations.filter(
      (i) => i.email === mockDb.currentUser()?.email && i.status === 'pending' && i.invitedBy === null,
    );
    expect(own).toHaveLength(1);
    expect(own[0]?.orgId).toBe(ids.org.alice);
    expect(
      mockDb.state.memberships.find((m) => m.orgId === ids.org.alice && m.userId === mockDb.currentUser()?.id)?.roleKey,
    ).toBe('owner');
    expect(own[0]?.createdAt).toBe(ago(2 * DAY - 3 * HOUR));
    expect(Date.parse(own[0]?.expiresAt ?? '') - Date.parse(INVITATIONS_MOCK_NOW)).toBe(3 * HOUR);
    const mine = await api.me.listInvitations({ query: { page: 1, pageSize: 20 } });
    expect(mine.items.filter((i) => i.invitedBy === null)).toHaveLength(1);
  });

  it('invitationChanged: resend and revoke of its pending row answer 409 and the row becomes accepted', async () => {
    scenarios.onboarding('invitationChanged');
    const [row] = await listed('pending');
    if (!row) throw new Error('no pending row');
    expect((await rejection(api.invitations.resend({ params: { ...anyOrg, invitationId: row.id } }))).status).toBe(409);
    expect(mockDb.state.invitations.find((i) => i.id === row.id)?.status).toBe('accepted');
    expect(await listed('pending')).toEqual([]);
  });

  it('invitationChanged: revoke answers 409 as well', async () => {
    scenarios.onboarding('invitationChanged');
    const [row] = await listed('pending');
    if (!row) throw new Error('no pending row');
    expect((await rejection(api.invitations.remove({ params: { ...anyOrg, invitationId: row.id } }))).status).toBe(409);
    expect(mockDb.state.invitations.find((i) => i.id === row.id)?.status).toBe('accepted');
  });

  it('the other scenarios resend normally', async () => {
    scenarios.onboarding('owner');
    const [row] = await listed('pending');
    if (!row) throw new Error('no pending row');
    const out = await api.invitations.resend({ params: { ...anyOrg, invitationId: row.id } });
    expect(out.status).toBe('pending');
  });
});

describe('checklists', () => {
  const checklist = () => api.orgs.checklist({ params: anyOrg });
  const projectsOf = async () =>
    (await api.projects.list({ query: { page: 1, pageSize: 20 } })).items.map((p) => p.id).sort();

  /** What the project already has set up: an agent with a credential, and rules. */
  const setup = (projectId: string) => ({
    credential: mockDb.state.agents.some((a) => a.projectId === projectId && a.credential.set),
    rules: mockDb.state.rules.filter((r) => r.projectId === projectId).length,
  });

  it('checklistNoProject: nothing done and the org has no project', async () => {
    scenarios.onboarding('checklistNoProject');
    expect(await checklist()).toMatchObject({ complete: false, projectId: null });
    expect(await projectsOf()).toEqual([]);
  });

  it('checklistPartial: one project, no agent and no rule', async () => {
    scenarios.onboarding('checklistPartial');
    const c = await checklist();
    expect(c.steps.map((s) => [s.key, s.done])).toEqual([
      ['connect_code_host', true],
      ['create_project', true],
      ['add_agent', false],
      ['add_rule', false],
    ]);
    expect(await projectsOf()).toEqual([ids.project.invoicerApi]);
    expect(c.projectId).toBe(ids.project.invoicerApi);
    expect(setup(ids.project.invoicerApi)).toEqual({ credential: false, rules: 0 });
  });

  it('checklistTwoProjects: the furthest-along project is P1, P2 is empty', async () => {
    scenarios.onboarding('checklistTwoProjects');
    const c = await checklist();
    expect(c.projectId).toBe(ids.project.invoicerApi);
    expect(c.steps.find((s) => s.key === 'add_agent')?.done).toBe(true);
    expect(c.steps.find((s) => s.key === 'add_rule')?.done).toBe(false);
    expect(await projectsOf()).toEqual([ids.project.invoicerApi, ids.project.invoicerWeb].sort());
    expect(setup(ids.project.invoicerApi)).toEqual({ credential: true, rules: 0 });
    expect(setup(ids.project.invoicerWeb)).toEqual({ credential: false, rules: 0 });
  });

  it('checklistComplete', async () => {
    scenarios.onboarding('checklistComplete');
    expect((await checklist()).complete).toBe(true);
  });
});

describe('ownerInvitationFailsOnce', () => {
  it('fails the next platform invitation create with 500 once', async () => {
    scenarios.onboarding('ownerInvitationFailsOnce');
    expect((await api.me.access()).platformAdmin).toBe(true);
    const body = { email: 'o@x.dev', roleId: roleId('owner'), scope: { type: 'org' } } as const;
    const params = { orgId: ids.org.acme };
    expect((await rejection(api.platform.createInvitation({ params, body }))).status).toBe(500);
    expect((await api.platform.createInvitation({ params, body })).email).toBe('o@x.dev');
  });
});

it('applyOnboardingScenario alone seeds the store without handler overrides', () => {
  const name: OnboardingScenario = 'twoOrgsSlowSwitch';
  applyOnboardingScenario(name);
  expect(mockDb.state.setActiveDelayMs).toBe(1500);
});
