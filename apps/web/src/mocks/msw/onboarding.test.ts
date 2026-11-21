import { type InvitationDto } from '@agentdesk/contracts';
// The contracts package's own client is what these tests drive; the restriction is for app code.

import { ApiError, createApi } from '@agentdesk/contracts/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roleFixtures } from '../dto/access';
import { ids } from '../dto/ids';
import { INVITATIONS_MOCK_NOW, orgInvitationFixtures } from '../dto/invitations';
import { mockDb } from './db';

const BASE = 'http://localhost:3000';
const api = createApi({ baseUrl: BASE, parse: true });
// The mock store scopes by the session's org; the route only needs a well-formed id.
const anyOrg = ids.created(777);
const orgParams = { orgId: anyOrg };
const byEmail = (email: string): InvitationDto => {
  const row = orgInvitationFixtures.find((i) => i.email === email);
  if (!row) throw new Error(`fixture ${email} missing`);
  return row;
};
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(INVITATIONS_MOCK_NOW));
  mockDb.state.invitations = orgInvitationFixtures.map((i) => ({ ...i, orgId: ids.org.alice }));
});
afterEach(() => vi.useRealTimers());

describe('org invitation lists', () => {
  it.each([
    ['pending', ['p@x.dev', 'q@x.dev']],
    ['accepted', ['a@x.dev']],
    ['declined', ['d@x.dev']],
    ['revoked', ['r@x.dev']],
    ['expired', ['e@x.dev']],
  ] as const)('status %s returns only its rows', async (status, emails) => {
    const page = await api.invitations.list({ params: orgParams, query: { status } });
    expect(page.items.map((i) => i.email).sort()).toEqual([...emails]);
    expect(page.total).toBe(emails.length);
    for (const item of page.items) expect(item.status).toBe(status);
  });

  it('defaults to pending and `all` returns every row, paged', async () => {
    const dflt = await api.invitations.list({ params: orgParams });
    expect(dflt.items.map((i) => i.status)).toEqual(['pending', 'pending']);
    const all = await api.invitations.list({ params: orgParams, query: { status: 'all', pageSize: 4 } });
    expect(all).toMatchObject({ total: 6, page: 1, pageSize: 4 });
    expect(all.items).toHaveLength(4);
  });

  it('a stored pending row past its expiry is listed as expired, not pending', async () => {
    const lapsed = mockDb.state.invitations.find((i) => i.email === 'p@x.dev');
    if (!lapsed) throw new Error('missing');
    lapsed.expiresAt = '2026-11-23T14:05:00.000Z';
    const pending = await api.invitations.list({ params: orgParams, query: { status: 'pending' } });
    expect(pending.items.map((i) => i.email)).toEqual(['q@x.dev']);
    const expired = await api.invitations.list({ params: orgParams, query: { status: 'expired' } });
    expect(expired.items.map((i) => i.email).sort()).toEqual(['e@x.dev', 'p@x.dev']);
    expect(expired.items.every((i) => i.status === 'expired')).toBe(true);
  });
});

describe('invitation create', () => {
  it('lowercases the email, expires in 172800 seconds and records the inviter', async () => {
    const created = await api.invitations.create({
      params: orgParams,
      body: { email: 'New@X.dev', roleId: roleId('member'), scope: { type: 'org' } },
    });
    expect(created).toMatchObject({
      email: 'new@x.dev',
      status: 'pending',
      invitedBy: { handle: 'alice' },
      expiresAt: '2026-11-25T14:05:00.000Z',
      createdAt: INVITATIONS_MOCK_NOW,
    });
  });

  it('create with P@X.dev when p@x.dev is pending answers 409 on /email', async () => {
    const err = await rejection(
      api.invitations.create({
        params: orgParams,
        body: { email: 'P@X.dev', roleId: roleId('member'), scope: { type: 'org' } },
      }),
    );
    expect(err.status).toBe(409);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/email' })]);
  });

  it('an email that is already a member answers 409 on /email', async () => {
    const err = await rejection(
      api.invitations.create({
        params: orgParams,
        body: { email: 'ALICE@example.com', roleId: roleId('member'), scope: { type: 'org' } },
      }),
    );
    expect(err.status).toBe(409);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/email' })]);
  });

  it('failNextOrgInvitationCreate fails one create with 500, then works again', async () => {
    mockDb.state.failNextOrgInvitationCreate = true;
    const body = { email: 'z@x.dev', roleId: roleId('member'), scope: { type: 'org' } } as const;
    expect((await rejection(api.invitations.create({ params: orgParams, body }))).status).toBe(500);
    await expect(api.invitations.create({ params: orgParams, body })).resolves.toMatchObject({ email: 'z@x.dev' });
  });
});

describe('invitation create refusals and platform use', () => {
  const adminNoOrg = () => {
    const user = mockDb.state.users[0];
    if (!user) throw new Error('no user');
    user.platformAdmin = true;
    mockDb.setActiveOrg(null);
  };

  it('platform.createInvitation works for a platform admin with no active org', async () => {
    adminNoOrg();
    const created = await api.platform.createInvitation({
      params: { orgId: ids.org.acme },
      body: { email: 'first@owner.dev', roleId: roleId('owner'), scope: { type: 'org' } },
    });
    expect(created).toMatchObject({ email: 'first@owner.dev', status: 'pending', invitedBy: { handle: 'alice' } });
    expect(mockDb.state.invitations.find((i) => i.email === 'first@owner.dev')?.orgId).toBe(ids.org.acme);
  });

  it('platform invitation routes answer 404 for an org that does not exist and store nothing', async () => {
    adminNoOrg();
    const params = { orgId: anyOrg };
    const invitationId = byEmail('p@x.dev').id;
    const before = mockDb.state.invitations.length;
    const calls = [
      () => api.platform.listInvitations({ params }),
      () =>
        api.platform.createInvitation({
          params,
          body: { email: 'ghost@owner.dev', roleId: roleId('owner'), scope: { type: 'org' } },
        }),
      () => api.platform.resendInvitation({ params: { ...params, invitationId } }),
      () => api.platform.removeInvitation({ params: { ...params, invitationId } }),
    ];
    for (const call of calls) {
      expect(await rejection(call())).toMatchObject({ status: 404, title: 'Organization not found' });
    }
    expect(mockDb.state.invitations).toHaveLength(before);
  });

  it('an unknown role answers 422 on /roleId', async () => {
    const err = await rejection(
      api.invitations.create({
        params: orgParams,
        body: { email: 'n@x.dev', roleId: ids.created(900), scope: { type: 'org' } },
      }),
    );
    expect(err.status).toBe(422);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/roleId' })]);
  });

  it('a role that cannot be given at the scope answers 422 on /roleId', async () => {
    const err = await rejection(
      api.invitations.create({
        params: orgParams,
        body: {
          email: 'n@x.dev',
          roleId: roleId('owner'),
          scope: { type: 'project', projectIds: [ids.project.invoicerApi] },
        },
      }),
    );
    expect(err.status).toBe(422);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/roleId' })]);
  });

  it('an unknown project answers 422 on its index under /scope/projectIds', async () => {
    const err = await rejection(
      api.invitations.create({
        params: orgParams,
        body: {
          email: 'n@x.dev',
          roleId: roleId('member'),
          scope: { type: 'project', projectIds: [ids.project.invoicerApi, ids.created(901)] },
        },
      }),
    );
    expect(err.status).toBe(422);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/scope/projectIds/1' })]);
  });
});

describe('invitation resend and revoke', () => {
  const idOf = (email: string) => byEmail(email).id;

  it('resend of an expired row makes it pending at now + 172800 seconds', async () => {
    const out = await api.invitations.resend({ params: { ...orgParams, invitationId: idOf('e@x.dev') } });
    expect(out).toMatchObject({ status: 'pending', expiresAt: '2026-11-25T14:05:00.000Z' });
  });

  it('resend of an accepted row answers 409 "Invitation is no longer pending"', async () => {
    const err = await rejection(api.invitations.resend({ params: { ...orgParams, invitationId: idOf('a@x.dev') } }));
    expect(err).toMatchObject({ status: 409, title: 'Invitation is no longer pending' });
  });

  it('resend of an expired row while a newer pending one holds the email answers 409 on /email', async () => {
    const expired = byEmail('e@x.dev');
    mockDb.state.invitations.push({
      ...expired,
      id: ids.created(501),
      status: 'pending',
      expiresAt: '2026-11-25T14:05:00.000Z',
      orgId: ids.org.alice,
    });
    const err = await rejection(api.invitations.resend({ params: { ...orgParams, invitationId: expired.id } }));
    expect(err.status).toBe(409);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/email' })]);
    expect(mockDb.state.invitations.find((i) => i.id === expired.id)?.status).toBe('expired');
  });

  it('revoke works on a pending row only', async () => {
    await api.invitations.remove({ params: { ...orgParams, invitationId: idOf('p@x.dev') } });
    expect(mockDb.state.invitations.find((i) => i.email === 'p@x.dev')?.status).toBe('revoked');
    const err = await rejection(api.invitations.remove({ params: { ...orgParams, invitationId: idOf('a@x.dev') } }));
    expect(err).toMatchObject({ status: 409, title: 'Invitation is not pending' });
  });
});

describe('invitation list order', () => {
  it('rows with the same createdAt come newest id first', async () => {
    const template = orgInvitationFixtures[0];
    if (!template) throw new Error('no fixture');
    mockDb.state.invitations = [1, 3, 2].map((n) => ({
      ...template,
      id: ids.created(600 + n),
      email: `same${n}@x.dev`,
      status: 'pending' as const,
      expiresAt: '2026-11-25T14:05:00.000Z',
      createdAt: '2026-11-22T10:00:00.000Z',
      orgId: ids.org.alice,
    }));
    const page = await api.invitations.list({ params: orgParams });
    expect(page.items.map((i) => i.id)).toEqual([ids.created(603), ids.created(602), ids.created(601)]);
  });
});

describe('invitee accept and decline', () => {
  const asInvitee = (email: string) => {
    const user = mockDb.state.users[0];
    if (!user) throw new Error('no user');
    user.email = email;
    mockDb.state.memberships = [];
  };

  it('lists only the invitee own pending invitations', async () => {
    asInvitee('P@X.dev');
    const page = await api.me.listInvitations();
    expect(page.items.map((i) => i.id)).toEqual([byEmail('p@x.dev').id]);
  });

  it('accept twice: the first joins the org, the second answers 409', async () => {
    asInvitee('p@x.dev');
    const invitationId = byEmail('p@x.dev').id;
    const out = await api.me.acceptInvitation({ params: { invitationId } });
    expect(out.org.id).toBe(ids.org.alice);
    expect(mockDb.state.memberships).toEqual([
      expect.objectContaining({ userId: ids.user.alice, orgId: ids.org.alice, roleKey: 'member' }),
    ]);
    const err = await rejection(api.me.acceptInvitation({ params: { invitationId } }));
    expect(err.status).toBe(409);
    expect(mockDb.state.memberships).toHaveLength(1);
  });

  it('accept or decline of an accepted invitation answers 409 carrying its status', async () => {
    asInvitee('p@x.dev');
    const invitationId = byEmail('p@x.dev').id;
    await api.me.acceptInvitation({ params: { invitationId } });
    for (const call of [
      () => api.me.acceptInvitation({ params: { invitationId } }),
      () => api.me.declineInvitation({ params: { invitationId } }),
    ]) {
      expect(await rejection(call())).toMatchObject({
        status: 409,
        title: 'Conflict',
        detail: 'Invitation is accepted',
      });
    }
  });

  it('decline of a declined invitation answers 409 carrying declined', async () => {
    asInvitee('p@x.dev');
    const invitationId = byEmail('p@x.dev').id;
    await api.me.declineInvitation({ params: { invitationId } });
    expect(await rejection(api.me.declineInvitation({ params: { invitationId } }))).toMatchObject({
      status: 409,
      detail: 'Invitation is declined',
    });
  });

  it('accept or decline by another email answers 404 and changes nothing', async () => {
    asInvitee('someone@else.dev');
    const invitationId = byEmail('p@x.dev').id;
    expect((await rejection(api.me.acceptInvitation({ params: { invitationId } }))).status).toBe(404);
    expect((await rejection(api.me.declineInvitation({ params: { invitationId } }))).status).toBe(404);
    expect((await rejection(api.me.getInvitation({ params: { invitationId } }))).status).toBe(404);
    expect(mockDb.state.invitations.find((i) => i.id === invitationId)?.status).toBe('pending');
  });

  it('decline sets declined; a second decline answers 409', async () => {
    asInvitee('p@x.dev');
    const invitationId = byEmail('p@x.dev').id;
    await api.me.declineInvitation({ params: { invitationId } });
    expect(mockDb.state.invitations.find((i) => i.id === invitationId)?.status).toBe('declined');
    expect((await rejection(api.me.declineInvitation({ params: { invitationId } }))).status).toBe(409);
  });

  it('an unverified email lists nothing and gets 404 on get, accept and decline', async () => {
    asInvitee('p@x.dev');
    const user = mockDb.state.users[0];
    if (user) user.emailVerified = false;
    const invitationId = byEmail('p@x.dev').id;
    expect((await api.me.listInvitations()).items).toEqual([]);
    expect((await rejection(api.me.getInvitation({ params: { invitationId } }))).status).toBe(404);
    expect((await rejection(api.me.acceptInvitation({ params: { invitationId } }))).status).toBe(404);
    expect((await rejection(api.me.declineInvitation({ params: { invitationId } }))).status).toBe(404);
    expect(mockDb.state.invitations.find((i) => i.id === invitationId)?.status).toBe('pending');
  });

  it('accepting while already a member keeps exactly one membership', async () => {
    asInvitee('p@x.dev');
    mockDb.state.memberships = [{ userId: ids.user.alice, orgId: ids.org.alice, roleKey: 'viewer' }];
    await api.me.acceptInvitation({ params: { invitationId: byEmail('p@x.dev').id } });
    expect(mockDb.state.memberships).toHaveLength(1);
    expect(mockDb.state.invitations.find((i) => i.email === 'p@x.dev')?.status).toBe('accepted');
  });

  it('accepting an expired invitation answers 409', async () => {
    asInvitee('e@x.dev');
    const err = await rejection(api.me.acceptInvitation({ params: { invitationId: byEmail('e@x.dev').id } }));
    expect(err.status).toBe(409);
  });
});

describe('the org check', () => {
  const get = (orgHeader: string) =>
    fetch(`${BASE}/api/orgs/${anyOrg}/invitations`, { headers: { 'x-org-id': orgHeader } });

  it('a header naming another org answers 409 org-mismatch', async () => {
    const res = await get(ids.org.acme);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ type: 'urn:agentdesk:problem:org-mismatch' });
  });

  it('a header naming the active org goes through', async () => {
    expect((await get(ids.org.alice)).status).toBe(200);
  });

  it('a header with no active org in the session is 409 org-mismatch', async () => {
    mockDb.setActiveOrg(null);
    const res = await get(ids.org.alice);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ type: 'urn:agentdesk:problem:org-mismatch' });
  });

  it('user and platform routes ignore the header', async () => {
    const res = await fetch(`${BASE}/api/me/invitations`, { headers: { 'x-org-id': ids.org.acme } });
    expect(res.status).toBe(200);
  });
});

describe('checklist, access and platform org', () => {
  it('checklist as a member answers 403', async () => {
    const m = mockDb.state.memberships.find((x) => x.orgId === ids.org.alice);
    if (!m) throw new Error('missing');
    m.roleKey = 'member';
    expect((await rejection(api.orgs.checklist({ params: orgParams }))).status).toBe(403);
  });

  it('checklist as an owner or an org admin answers the org checklist', async () => {
    await expect(api.orgs.checklist({ params: orgParams })).resolves.toMatchObject({ steps: expect.any(Array) });
    const m = mockDb.state.memberships.find((x) => x.orgId === ids.org.alice);
    if (m) m.roleKey = 'admin';
    await expect(api.orgs.checklist({ params: orgParams })).resolves.toMatchObject({ steps: expect.any(Array) });
  });

  it('me.access reports platformAdmin from the user', async () => {
    expect((await api.me.access()).platformAdmin).toBe(false);
    const user = mockDb.state.users[0];
    if (user) user.platformAdmin = true;
    expect((await api.me.access()).platformAdmin).toBe(true);
  });

  it('platform routes answer 403 for a non-admin and make no org', async () => {
    const err = await rejection(api.platform.createOrg({ body: { name: 'Globex', slug: 'globex' } }));
    expect(err.status).toBe(403);
    expect(mockDb.state.orgs.map((o) => o.slug)).not.toContain('globex');
    expect((await rejection(api.platform.listOrgs())).status).toBe(403);
  });

  it('a platform admin with an unverified email is refused too', async () => {
    const user = mockDb.state.users[0];
    if (user) Object.assign(user, { platformAdmin: true, emailVerified: false });
    expect((await rejection(api.platform.createOrg({ body: { name: 'G', slug: 'g' } }))).status).toBe(403);
  });

  it('platform.createOrg adds the org and answers 409 on /slug when taken', async () => {
    const admin = mockDb.state.users[0];
    if (admin) admin.platformAdmin = true;
    const out = await api.platform.createOrg({ body: { name: 'Globex', slug: 'globex' } });
    expect(out).toMatchObject({ name: 'Globex', slug: 'globex' });
    expect(mockDb.state.orgs.map((o) => o.slug)).toContain('globex');
    const err = await rejection(api.platform.createOrg({ body: { name: 'Globex 2', slug: 'globex' } }));
    expect(err.status).toBe(409);
    expect(err.errors).toEqual([expect.objectContaining({ pointer: '/slug' })]);
  });
});

describe('set-active delay', () => {
  it('holds the set-active answer for setActiveDelayMs', async () => {
    mockDb.state.setActiveDelayMs = 1500;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    vi.setSystemTime(new Date(INVITATIONS_MOCK_NOW));
    let done = false;
    const call = fetch(`${BASE}/auth/organization/set-active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationSlug: 'acme' }),
    }).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    expect(mockDb.auth.activeOrganizationId).toBe(ids.org.alice);
    await vi.advanceTimersByTimeAsync(600);
    expect((await call).status).toBe(200);
    expect(mockDb.auth.activeOrganizationId).toBe(ids.org.acme);
  });
});
