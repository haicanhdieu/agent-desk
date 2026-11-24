import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { buildRunJob, FakeKubeGateway } from '@agentdesk/core';
import { connections, member, organization, runs, withOrg } from '@agentdesk/db';
import { AUTH, type createAuth } from '../src/auth/auth';
import { signState } from '../src/connections/install-state';
import { createTestApp, type TestApp } from './helpers/app';
import {
  acceptInvite,
  asPlatformAdmin,
  createOrg,
  invite,
  inviteAndLogin,
  loginAs,
  reactivateOrgRoute,
  suspendedOrgApp,
  userIdOf,
} from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const REASON = 'Unpaid invoice 4711';
const FIXED_DETAIL = 'This organization is suspended.';
const ORIGIN = 'http://localhost:5173';
const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

let t: TestApp;
let stateDir: string;
let real: FakeKubeGateway;
let wsBase: string;
let adminCookie: string;
let orgA: string; // suspended during the run
let orgB: string; // stays active
let projectA: string;
let projectB: string;
let pausedRun: string;
let podRun: string;
let openSocket: WebSocket;
let openSocketClosed: Promise<number>;
const cookies = {} as Record<(typeof ROLES)[number], string>;
let multi: string; // owner of A and B, session active in A
let dual: string; // owner of A and B, session active in A
let ex: string; // member of A until the membership row is deleted
let outsider: string; // owner of B only
let adminInA: string; // the platform admin as a viewer of A
let inviteeCookie: string;
let inviteId: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(25);
  }
}

async function insertRun(orgId: string, projectId: string, status: string): Promise<string> {
  return withOrg(t.db, orgId, async (tx) => {
    const [row] = await tx
      .insert(runs)
      .values({
        orgId,
        projectId,
        command: 'fix',
        skillName: 'fix',
        ticketRef: `os-${randomUUID()}`,
        ticketKind: 'issue',
        checkoutRef: 'refs/heads/main',
        triggerSource: 'webhook',
        status,
      })
      .returning({ id: runs.id });
    if (!row) throw new Error('no row');
    return row.id;
  });
}

async function runCount(orgId: string): Promise<number> {
  return withOrg(t.db, orgId, async (tx) => (await tx.select({ id: runs.id }).from(runs)).length);
}

function wsConnect(runId: string, cookie: string): { ws: WebSocket; closed: Promise<number> } {
  const ws = new WebSocket(`${wsBase}/api/runs/${runId}/terminal`, { headers: { cookie, origin: ORIGIN } });
  ws.on('error', () => undefined);
  return { ws, closed: new Promise<number>((resolve) => ws.on('close', (code) => resolve(code))) };
}

function get(url: string, cookie: string) {
  return t.app.inject({ method: 'GET', url, headers: { cookie } });
}

/** The refusal of a suspended org: 403, type org-suspended, the fixed text and nothing about the org. */
function expectSuspended(res: { statusCode: number; body: string; json: <T>() => T }, why: string): void {
  expect(res.statusCode, why).toBe(403);
  const body = res.json<Record<string, unknown>>();
  expect(body, why).toMatchObject({ type: 'org-suspended', title: 'Forbidden', status: 403, detail: FIXED_DETAIL });
  expect(Object.keys(body).sort(), why).toEqual(['detail', 'requestId', 'status', 'title', 'type']);
  expect(res.body, why).not.toMatch(/4711|invoice|suspended_at|suspendedAt|reason/i);
}

function expectPlain403(res: { statusCode: number; body: string; json: <T>() => T }, why: string): void {
  expect(res.statusCode, why).toBe(403);
  expect(res.json<{ type: string }>().type, why).toBe('about:blank');
  expect(res.body, why).not.toMatch(/suspend/i);
}

beforeAll(async () => {
  stateDir = freshStateDir();
  real = new FakeKubeGateway(join(stateDir, 'kube'), { turnMs: 100 });
  t = await createTestApp({
    env: { FAKE_STATE_DIR: stateDir, TERMINAL_PING_MS: '150', TERMINAL_REAUTH_MS: '200' },
    wrapAdapters: wideFakeRepos,
    kube: real,
  });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  wsBase = `ws://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
  adminCookie = await asPlatformAdmin(t);
  orgA = (await createOrg(t, 'Suspend A', 'suspend-a')).id;
  orgB = (await createOrg(t, 'Suspend B', 'suspend-b')).id;
  for (const role of ROLES) cookies[role] = await inviteAndLogin(t, orgA, `os-${role}`, role, { type: 'org' });
  multi = await inviteAndLogin(t, orgA, 'os-multi', 'owner', { type: 'org' });
  await inviteAndLogin(t, orgB, 'os-multi', 'member', { type: 'org' });
  dual = await inviteAndLogin(t, orgA, 'os-dual', 'owner', { type: 'org' });
  await inviteAndLogin(t, orgB, 'os-dual', 'owner', { type: 'org' });
  ex = await inviteAndLogin(t, orgA, 'os-ex', 'member', { type: 'org' });
  outsider = await inviteAndLogin(t, orgB, 'os-outsider', 'owner', { type: 'org' });
  adminInA = await inviteAndLogin(t, orgA, 'admin', 'viewer', { type: 'org' });
  projectA = (await makeProject(t, cookies.owner, await installFake(t, cookies.owner))).projectId;
  projectB = (await makeProject(t, outsider, await installFake(t, outsider))).projectId;
  pausedRun = await insertRun(orgA, projectA, 'paused');
  podRun = await insertRun(orgA, projectA, 'running');
  await real.ensureJob(
    buildRunJob({
      runId: podRun,
      orgId: orgA,
      projectId: projectA,
      image: 'fake',
      prompt: 'do it',
      agentEnv: [{ name: 'AGENT_MODEL', value: 'claude-opus-4-1' }],
      checkoutRef: 'main',
      credentialEnvKeys: [],
      gitUsername: 'x-access-token',
      gitHost: 'fake.invalid',
      cliTokenEnvName: 'GH_TOKEN',
      maxTurns: null,
      deadlineSeconds: 120,
      resume: false,
      botName: 'bot',
      botEmail: 'bot@x.invalid',
      author: { name: 'bot', email: 'bot@x.invalid', authorizedBy: 'bot' },
      pluginMarketplaces: {},
      setupTimeoutSeconds: 600,
      setupScript: null,
      pod: {
        cpuRequest: '1',
        cpuLimit: '1',
        memoryRequest: '1Gi',
        memoryLimit: '1Gi',
        ephemeralStorageLimit: '1Gi',
        workspaceSizeLimit: '1Gi',
      },
    }),
  );
  await until(async () => (await real.getRunPod(`run-${podRun}`))?.phase === 'Running');
  // A terminal attached while the org is still active; it must close at its next re-auth after the suspension.
  const c = wsConnect(podRun, cookies.owner);
  openSocket = c.ws;
  openSocketClosed = c.closed;
  await new Promise<void>((resolve) => openSocket.on('open', () => resolve()));
  // An invitation made before the suspension, accepted after it.
  inviteeCookie = '';
  inviteId = (await invite(t, orgA, 'os-invitee@dev.local', 'member', { type: 'org' })).id;
  inviteeCookie = await loginAs(t, 'os-invitee');
  await suspendedOrgApp(t, orgA, REASON);
  t.temporal.reset();
});

afterAll(async () => {
  openSocket.terminate();
  await real.killAll();
  await t.close();
  rmSync(stateDir, { recursive: true, force: true });
});

describe('a suspended org at the tenant guard', () => {
  it.each(ROLES)('refuses a %s on a read, a write, me.access and a dev route with org-suspended', async (role) => {
    const cookie = cookies[role];
    expectSuspended(await get('/api/projects', cookie), 'read');
    expectSuspended(
      await t.app.inject({
        method: 'PUT',
        url: `/api/projects/${projectA}/setup-script`,
        headers: { cookie },
        payload: {},
      }),
      'write',
    );
    expectSuspended(await get('/api/me/access', cookie), 'me.access');
    expectSuspended(
      await t.app.inject({ method: 'POST', url: '/dev/fake/comments', headers: { cookie }, payload: {} }),
      'dev route',
    );
  });

  it('refuses before the permission: a viewer on an owner-only write gets org-suspended, not the plain 403', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/orgs/${orgA}`,
      headers: { cookie: cookies.viewer },
      payload: { name: 'Nope' },
    });
    expectSuspended(res, 'update org');
  });

  it('refuses an event stream connect (SSE) with org-suspended', async () => {
    expectSuspended(await get(`/api/projects/${projectA}/events`, cookies.owner), 'project events');
    expectSuspended(await get(`/api/runs/${podRun}/events`, cookies.member), 'run events');
  });

  it('refuses a new terminal attach with 4403', async () => {
    const c = wsConnect(podRun, cookies.owner);
    expect(await c.closed).toBe(4403);
  });

  it('closes an open terminal at its next re-auth with 4403', async () => {
    expect(await openSocketClosed).toBe(4403);
  });

  it('refuses a resume and starts no workflow, signal or run', async () => {
    await openSocketClosed; // its detach signal is not the resume's
    await sleep(300);
    t.temporal.reset();
    const before = await runCount(orgA);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/runs/${pausedRun}/resume`,
      headers: { cookie: cookies.owner },
    });
    expectSuspended(res, 'resume');
    expect(t.temporal.calls).toEqual([]);
    expect(await runCount(orgA)).toBe(before);
  });

  it('refuses a poll now and a dev comment (the ways a run starts) and starts no workflow, signal or run', async () => {
    t.temporal.reset();
    const before = await runCount(orgA);
    expectSuspended(
      await t.app.inject({
        method: 'POST',
        url: `/api/projects/${projectA}/connection/poll`,
        headers: { cookie: cookies.owner },
      }),
      'poll now',
    );
    expectSuspended(
      await t.app.inject({
        method: 'POST',
        url: '/dev/fake/comments',
        headers: { cookie: cookies.owner },
        payload: { repoPath: 'dev/demo', ticketNumber: 1, body: '/fix please', author: 'alice', deliver: 'webhook' },
      }),
      'dev comment',
    );
    expect(t.temporal.calls).toEqual([]);
    expect(await runCount(orgA)).toBe(before);
  });

  it('answers a non-member the plain 403 and never the suspension', async () => {
    await t.db.pool.query(
      'delete from member where user_id = (select id from "user" where email = $1) and organization_id = $2',
      ['os-ex@dev.local', orgA],
    );
    expectPlain403(await get('/api/projects', ex), 'read');
    expectPlain403(await get('/api/me/access', ex), 'me.access');
    expectPlain403(
      await t.app.inject({ method: 'POST', url: '/dev/fake/comments', headers: { cookie: ex }, payload: {} }),
      'dev',
    );
    const rows = await t.db.orm.select({ id: member.id }).from(member).where(eq(member.organizationId, orgA));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('answers a non-member of the suspended org the plain refusal on an SSE connect and a terminal attach', async () => {
    expectPlain403(await get(`/api/projects/${projectA}/events`, ex), 'project events');
    expectPlain403(await get(`/api/runs/${podRun}/events`, ex), 'run events');
    const ws = new WebSocket(`${wsBase}/api/runs/${podRun}/terminal`, { headers: { cookie: ex, origin: ORIGIN } });
    ws.on('error', () => undefined);
    const closed = await new Promise<{ code: number; reason: string }>((resolve) =>
      ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })),
    );
    expect(closed.code).toBe(4403);
    expect(closed.reason).not.toMatch(/suspend/i);
  });

  it("keeps the member's other org working and does not let it reach the suspended org's data", async () => {
    const set = await t.app.inject({
      method: 'POST',
      url: '/auth/organization/set-active',
      headers: { cookie: multi },
      payload: { organizationId: orgB },
    });
    expect(set.statusCode, set.body).toBe(200);
    expect((await get('/api/projects', multi)).statusCode).toBe(200);
    expect((await get('/api/me/access', multi)).statusCode).toBe(200);
    // Org B's owner cannot see a project of the suspended org A: 404, not the suspension.
    expect((await get(`/api/projects/${projectA}`, outsider)).statusCode).toBe(404);
    expect((await get(`/api/projects/${projectB}`, outsider)).statusCode).toBe(200);
  });

  it('refuses an install callback whose state names the suspended org while the session is active in another org', async () => {
    // dual owns A (suspended) and B (active); a state minted in A while it was active is redeemed with the session
    // active in B (set-active is allowed), so the route guard passes for B.
    const set = await t.app.inject({
      method: 'POST',
      url: '/auth/organization/set-active',
      headers: { cookie: dual },
      payload: { organizationId: orgB },
    });
    expect(set.statusCode, set.body).toBe(200);
    const state = signState(t.config.BETTER_AUTH_SECRET, { orgId: orgA, userId: await userIdOf(t, 'os-dual') });
    const before = await withOrg(t.db, orgA, (tx) => tx.select({ id: connections.id }).from(connections));
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/connections/fake/callback?state=${encodeURIComponent(state)}`,
      headers: { cookie: dual },
    });
    expectSuspended(res, 'install callback');
    const after = await withOrg(t.db, orgA, (tx) => tx.select({ id: connections.id }).from(connections));
    expect(after.length).toBe(before.length);
  });

  it('answers a non-member the plain 403 on an install callback whose state names the suspended org', async () => {
    const outsiderId = await userIdOf(t, 'os-outsider');
    const state = signState(t.config.BETTER_AUTH_SECRET, { orgId: orgA, userId: outsiderId });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/connections/fake/callback?state=${encodeURIComponent(state)}`,
      headers: { cookie: outsider },
    });
    expectPlain403(res, 'install callback, non-member');
  });

  it('lets a member switch to the suspended org and lists it with status suspended', async () => {
    const back = await t.app.inject({
      method: 'POST',
      url: '/auth/organization/set-active',
      headers: { cookie: multi },
      payload: { organizationId: orgA },
    });
    expect(back.statusCode, back.body).toBe(200);
    const list = await get('/auth/organization/list', multi);
    expect(list.statusCode).toBe(200);
    const rows = list.json<{ id: string; status?: string }[]>();
    expect(rows.find((o) => o.id === orgA)?.status).toBe('suspended');
    expect(rows.find((o) => o.id === orgB)?.status).toBe('active');
    expect(list.body).not.toMatch(/suspended_at|suspendedAt|4711/);
    expectSuspended(await get('/api/projects', multi), 'active org is the suspended one');
  });

  it('keeps platform routes for the org answering the platform admin', async () => {
    const res = await get(`/api/platform/orgs/${orgA}`, adminCookie);
    expect(res.statusCode, res.body).toBe(200);
    expect((await get(`/api/platform/orgs/${orgA}/members`, adminCookie)).statusCode).toBe(200);
  });

  it('lets an invitee accept an invitation into the suspended org', async () => {
    const res = await acceptInvite(t, inviteeCookie, inviteId);
    expect(res.statusCode, res.body).toBe(200);
    const rows = await t.db.pool.query(
      'select 1 from member where organization_id = $1 and user_id = (select id from "user" where email = $2)',
      [orgA, 'os-invitee@dev.local'],
    );
    expect(rows.rowCount).toBe(1);
  });

  it('answers me.platform true for a platform admin whose active org is suspended, while me.access is 403', async () => {
    const platform = await get('/api/me/platform', adminInA);
    expect(platform.statusCode).toBe(200);
    expect(platform.json()).toEqual({ platformAdmin: true });
    expectSuspended(await get('/api/me/access', adminInA), 'me.access');
  });

  it('never lets a client write status through a better-auth organization path', async () => {
    for (const [url, payload] of [
      ['/auth/organization/update', { organizationId: orgA, data: { status: 'active' } }],
      ['/auth/organization/update', { organizationId: orgB, data: { status: 'suspended' } }],
      ['/auth/organization/create', { name: 'Evil', slug: 'evil', status: 'suspended' }],
    ] as const) {
      const res = await t.app.inject({ method: 'POST', url, headers: { cookie: cookies.owner }, payload });
      expect(res.statusCode, `${url} ${res.body}`).toBeGreaterThanOrEqual(400);
    }
    const rows = await t.db.orm.select({ id: organization.id, status: organization.status }).from(organization);
    expect(rows.find((r) => r.id === orgA)?.status).toBe('suspended');
    expect(rows.find((r) => r.id === orgB)?.status).toBe('active');
  });

  it('never lets a client write status through the better-auth organization api itself', async () => {
    const auth = t.app.get<ReturnType<typeof createAuth>>(AUTH);
    const tries = [
      auth.api.updateOrganization({
        headers: new Headers({ cookie: cookies.owner }),
        body: { organizationId: orgA, data: { name: 'Suspend A', status: 'active' } as { name?: string } },
      }),
      auth.api.updateOrganization({
        headers: new Headers({ cookie: outsider }),
        body: { organizationId: orgB, data: { name: 'Suspend B', status: 'suspended' } as { name?: string } },
      }),
    ];
    // The library drops `status` (input: false) and applies the rest; the update itself succeeds.
    for (const attempt of tries) await expect(attempt).resolves.toBeDefined();
    const rows = await t.db.orm.select({ id: organization.id, status: organization.status }).from(organization);
    expect(rows.find((r) => r.id === orgA)?.status).toBe('suspended');
    expect(rows.find((r) => r.id === orgB)?.status).toBe('active');
  });

  it('answers 200 for the same member after the org is reactivated', async () => {
    const res = await reactivateOrgRoute(t, adminCookie, orgA, { reason: 'Paid' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await get('/api/projects', cookies.owner)).statusCode).toBe(200);
    expect((await get('/api/me/access', cookies.viewer)).statusCode).toBe(200);
  });
});
