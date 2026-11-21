import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  RequestMethod,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import type { Logger } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flattenRoutes, routeAccess, routes, type RouteKey } from '@agentdesk/contracts';
import { roleAssignments, roles, rules as rulesTable, runs, setupTests, withOrg } from '@agentdesk/db';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { WebSocket } from 'ws';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { routeEntryFor } from '../src/access/route-entry';
import type { Auth } from '../src/auth/auth';
import { SessionGuard } from '../src/auth/session.guard';
import type { Config } from '../src/config/config.module';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, createOrg, inviteAndLogin, userIdOf } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

/**
 * Route keys whose controllers are added by later tasks of the RBAC plan. Each entry is asserted to be still
 * unregistered, so the task that adds the controller must delete its line here.
 */
const NOT_REGISTERED_YET: RouteKey[] = [];

/** Served through a WebSocket gateway, not a Nest HTTP controller. */
const TERMINAL_KEYS: RouteKey[] = ['runs.terminal', 'setupTests.terminal'];

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.ALL]: 'ALL',
};

const joinPath = (...parts: string[]): string =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter((s) => s !== '')
    .join('/');

const first = (v: unknown): string => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : '';
};

interface Registered {
  method: string;
  url: string;
}

function registeredRoutes(t: TestApp): Registered[] {
  const discovery = new DiscoveryService(t.app.get(ModulesContainer));
  const out: Registered[] = [];
  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype;
    if (typeof metatype !== 'function') continue;
    const prefix = first(Reflect.getMetadata(PATH_METADATA, metatype));
    const proto = metatype.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const verb: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      if (typeof verb !== 'number') continue;
      const path = first(Reflect.getMetadata(PATH_METADATA, handler));
      out.push({ method: METHOD_NAMES[verb] ?? String(verb), url: joinPath(prefix, path) });
    }
  }
  return out;
}

describe('route discovery (deny by default)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('every controller route under /api has a route entry and every one under /dev is a dev route', () => {
    const found = registeredRoutes(t);
    expect(found.length).toBeGreaterThan(40);
    const api = found.filter((r) => r.url === '/api' || r.url.startsWith('/api/'));
    const dev = found.filter((r) => r.url === '/dev' || r.url.startsWith('/dev/'));
    expect(api.length).toBeGreaterThan(40);
    expect(dev.length).toBeGreaterThan(0);
    for (const r of api) {
      expect(routeEntryFor(r.method, r.url).kind, `${r.method} ${r.url}`).toBe('route');
    }
    for (const r of dev) {
      expect(routeEntryFor(r.method, r.url).kind, `${r.method} ${r.url}`).toBe('dev');
    }
  });

  it('no controller route uses ALL, so every route has exactly one method', () => {
    expect(registeredRoutes(t).filter((r) => r.method === 'ALL' && !r.url.startsWith('/auth'))).toEqual([]);
  });

  it('every routeAccess key is registered, a terminal socket, or listed as added by a later task', () => {
    const keys = new Set<string>();
    for (const r of registeredRoutes(t)) {
      const m = routeEntryFor(r.method, r.url);
      if (m.kind === 'route') keys.add(m.key);
    }
    const missing = (Object.keys(routeAccess) as RouteKey[]).filter(
      (k) => !keys.has(k) && !TERMINAL_KEYS.includes(k) && !NOT_REGISTERED_YET.includes(k),
    );
    expect(missing).toEqual([]);
    // the allow-lists cannot go stale: a key that is registered now must leave NOT_REGISTERED_YET
    expect(NOT_REGISTERED_YET.filter((k) => keys.has(k))).toEqual([]);
    expect(TERMINAL_KEYS.filter((k) => keys.has(k))).toEqual([]);
  });

  it('the terminal keys exist in the route table', () => {
    const flat = flattenRoutes(routes);
    for (const k of TERMINAL_KEYS) expect(flat[k]).toBeDefined();
  });
});

@Controller('api/authz-probe')
class UnlistedController {
  @Get()
  get() {
    return { ok: true };
  }
}

describe('an /api route with no entry', () => {
  it('is refused with 403 even for a signed-in member', async () => {
    const t = await createTestApp({ controllers: [UnlistedController] });
    try {
      const home = await createOrg(t, 'Probe Home', 'probe-home');
      const cookie = await inviteAndLogin(t, home.id, 'probe', 'member', { type: 'org' });
      const res = await t.app.inject({ method: 'GET', url: '/api/authz-probe', headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ detail: FORBIDDEN_DETAIL });
      const anon = await t.app.inject({ method: 'GET', url: '/api/authz-probe' });
      expect(anon.statusCode).toBe(401);
    } finally {
      await t.close();
    }
  });
});

// ---- the guard, called directly with a stubbed session over a real database ----

interface Person {
  userId: string;
  email: string;
  orgId: string;
}

interface Opts {
  who?: Person;
  emailVerified?: boolean;
  activeOrgId?: string | null;
  noSession?: boolean;
  admins?: string[];
  params?: Record<string, unknown>;
}
interface Call {
  method: string;
  routeUrl: string;
  url?: string;
  params?: Record<string, unknown>;
}

function runGuard(t: TestApp, call: Call, opts: Opts) {
  const denies: { obj: Record<string, unknown>; msg: string }[] = [];
  const logger = {
    info: (obj: Record<string, unknown>, msg: string) => denies.push({ obj, msg }),
    warn: () => undefined,
  } as unknown as Logger; // only the info and warn levels are used by the guard
  const who = opts.who;
  const session =
    opts.noSession || !who
      ? null
      : {
          session: { activeOrganizationId: opts.activeOrgId === undefined ? who.orgId : opts.activeOrgId },
          user: { id: who.userId, email: who.email, emailVerified: opts.emailVerified ?? true },
        };
  const auth = { api: { getSession: async () => session } } as unknown as Auth; // the guard only reads getSession
  const config = { ...t.config, PLATFORM_ADMIN_EMAILS: opts.admins ?? [] } as Config;
  const guard = new SessionGuard(auth, t.db, config, logger);
  const req: Record<string, unknown> = {
    id: 'req-test',
    method: call.method,
    url: call.url ?? call.routeUrl,
    routeOptions: { url: call.routeUrl },
    params: opts.params ?? call.params ?? {},
    headers: {},
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext; // only getRequest is used
  return { req, denies, result: guard.canActivate(ctx) };
}

describe('SessionGuard route kinds', () => {
  let t: TestApp;
  let nobody: Person; // member of an org, no assignment
  let owner: Person; // org-scope owner of their org
  let viewer: Person; // org-scope viewer of their org

  /** A member of their own org holding `roleKey` on it, or (null) a member whose only assignment is then removed. */
  async function person(handle: string, roleKey: 'owner' | 'viewer' | null): Promise<Person> {
    const org = await createOrg(t, handle, handle);
    await inviteAndLogin(t, org.id, handle, roleKey ?? 'viewer', { type: 'org' });
    const userId = await userIdOf(t, handle);
    if (roleKey === null) {
      // Off-list data: a member with no assignment cannot be made through the invitation flow.
      await withOrg(t.db, org.id, (tx) => tx.delete(roleAssignments).where(eq(roleAssignments.userId, userId)));
    }
    return { userId, email: `${handle}@dev.local`, orgId: org.id };
  }

  beforeAll(async () => {
    t = await createTestApp();
    nobody = await person('az-nobody', null);
    owner = await person('az-owner', 'owner');
    viewer = await person('az-viewer', 'viewer');
  });
  afterAll(async () => {
    await t.close();
  });
  const run = (call: Call, opts: Opts) => runGuard(t, call, opts);

  const PLATFORM: Call = { method: 'POST', routeUrl: '/api/platform/orgs' };
  const ASSIGNMENTS: Call = { method: 'GET', routeUrl: '/api/orgs/:orgId/assignments' };
  const ME: Call = { method: 'GET', routeUrl: '/api/me/access' };

  it('refuses a request without a session with 401', async () => {
    await expect(run(PLATFORM, { noSession: true }).result).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(run(ME, { noSession: true }).result).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets public paths through without looking at a session', async () => {
    await expect(run({ method: 'GET', routeUrl: '/healthz' }, { noSession: true }).result).resolves.toBe(true);
    await expect(run({ method: 'GET', routeUrl: '/api/docs/json' }, { noSession: true }).result).resolves.toBe(true);
  });

  describe('platform routes', () => {
    const admins = ['admin@dev.local'];
    const adminPerson = (): Person => ({ ...owner, email: 'admin@dev.local' });

    it('refuse a caller whose email is not listed, even an org owner (BR-70)', async () => {
      const r = run(PLATFORM, { who: owner, admins });
      await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(r.result).rejects.toMatchObject({ message: FORBIDDEN_DETAIL });
    });

    it('refuse a listed email that is not verified', async () => {
      await expect(run(PLATFORM, { who: adminPerson(), admins, emailVerified: false }).result).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuse everyone while the admin list is empty', async () => {
      await expect(run(PLATFORM, { who: adminPerson(), admins: [] }).result).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admit a listed verified email with no active organization and set the platform admin only', async () => {
      const r = run(PLATFORM, { who: adminPerson(), admins, activeOrgId: null });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['platformAdmin']).toEqual({ userId: owner.userId, email: 'admin@dev.local' });
      expect(r.req['orgContext']).toBeUndefined();
      expect(r.req['authz']).toBeUndefined();
    });

    it('admit a listed verified email whatever the case of the session email', async () => {
      const who = { ...owner, email: 'Admin@Dev.LOCAL' };
      await expect(run(PLATFORM, { who, admins, activeOrgId: null }).result).resolves.toBe(true);
    });
  });

  describe('a platform admin on tenant routes gets nothing for being one', () => {
    const admins = ['az-nobody@dev.local'];
    it('is refused on an org-admin route when not a member of the active org', async () => {
      const r = run(ASSIGNMENTS, { who: nobody, admins, activeOrgId: owner.orgId, params: { orgId: owner.orgId } });
      await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('keeps only tenant grants when also a member', async () => {
      const r = run(ASSIGNMENTS, { who: nobody, admins, params: { orgId: nobody.orgId } });
      await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
      expect(r.denies[0]?.obj).toMatchObject({ routeKey: 'assignments.list', userId: nobody.userId });
    });
  });

  it('refuses an /api route with no entry with 403, for an owner and for a platform admin alike', async () => {
    const unknown: Call = { method: 'GET', routeUrl: '/api/not-a-route' };
    await expect(run(unknown, { who: owner }).result).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      run(unknown, { who: { ...owner, email: 'admin@dev.local' }, admins: ['admin@dev.local'] }).result,
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an /api route whose Fastify url is missing (fail closed)', async () => {
    const r = run({ method: 'GET', routeUrl: '', url: '/api/projects' }, { who: owner });
    await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('org routes', () => {
    it('refuse a caller with no active organization', async () => {
      await expect(run(ME, { who: owner, activeOrgId: null }).result).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('refuse a caller who is not a member of the active organization', async () => {
      await expect(run(ME, { who: nobody, activeOrgId: owner.orgId }).result).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
    it('answer 404 for an :orgId that is not the active organization', async () => {
      const r = run(ASSIGNMENTS, { who: owner, params: { orgId: nobody.orgId } });
      await expect(r.result).rejects.toBeInstanceOf(NotFoundException);
    });
    it('answer 404 for an :orgId that is not a string', async () => {
      const r = run(ASSIGNMENTS, { who: owner, params: { orgId: 42 } });
      await expect(r.result).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('self routes', () => {
    it('admit a member with no assignment and load their access', async () => {
      const r = run(ME, { who: nobody });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['authz']).toMatchObject({ routeKey: 'me.access', access: { userId: nobody.userId, grants: [] } });
      expect(r.req['orgContext']).toMatchObject({ userId: nobody.userId, orgId: nobody.orgId });
    });
  });

  describe('org-admin routes', () => {
    const params = (p: Person) => ({ orgId: p.orgId });
    it('refuse a member who holds none of the permissions anywhere, and log the deny', async () => {
      const r = run(ASSIGNMENTS, { who: nobody, params: params(nobody) });
      await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(r.result).rejects.toMatchObject({ message: FORBIDDEN_DETAIL });
      expect(r.denies).toHaveLength(1);
      expect(r.denies[0]?.obj).toEqual({
        requestId: 'req-test',
        orgId: nobody.orgId,
        userId: nobody.userId,
        routeKey: 'assignments.list',
        permission: 'assignment:read',
      });
    });
    it('refuse a viewer on a route that needs assignment:create', async () => {
      const r = run(
        { method: 'POST', routeUrl: '/api/orgs/:orgId/assignments' },
        { who: viewer, params: params(viewer) },
      );
      await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('admit an owner and keep the access for the handler', async () => {
      const r = run(ASSIGNMENTS, { who: owner, params: params(owner) });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['authz']).toMatchObject({ routeKey: 'assignments.list' });
    });
  });

  describe('org, project and project-list routes', () => {
    const LIST: Call = { method: 'GET', routeUrl: '/api/projects' };
    const CREATE: Call = { method: 'POST', routeUrl: '/api/projects' };
    const GET: Call = { method: 'GET', routeUrl: '/api/projects/:projectId' };
    const CALLBACK: Call = { method: 'GET', routeUrl: '/api/connections/:provider/callback' };
    const RANDOM = '5b0f5d6e-8f4e-4c55-9d52-0c2f3a9a1e11';

    it('refuse a member with no assignment everywhere, a random project id included (BR-6), and log the deny', async () => {
      for (const call of [LIST, CREATE, CALLBACK, GET]) {
        const r = run(call, { who: nobody, params: { projectId: RANDOM } });
        await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
        await expect(r.result).rejects.toMatchObject({ message: FORBIDDEN_DETAIL });
      }
      const r = run(GET, { who: nobody, params: { projectId: RANDOM } });
      await expect(r.result).rejects.toBeInstanceOf(ForbiddenException);
      expect(r.denies[0]?.obj).toMatchObject({ routeKey: 'projects.get', permission: 'project:read' });
    });
    it('admit a viewer to the project list but refuse project create and the install callback', async () => {
      await expect(run(LIST, { who: viewer }).result).resolves.toBe(true);
      await expect(run(CREATE, { who: viewer }).result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(run(CALLBACK, { who: viewer }).result).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('admit an owner on project create and map the install callback to connections.install', async () => {
      await expect(run(CREATE, { who: owner }).result).resolves.toBe(true);
      const r = run(CALLBACK, { who: owner });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['authz']).toMatchObject({ routeKey: 'connections.install' });
    });
    it('answer 404 for a project that does not exist, is malformed or has no id, once the permission is held', async () => {
      for (const params of [{ projectId: RANDOM }, { projectId: 'not-a-uuid' }, {}]) {
        await expect(run(GET, { who: viewer, params }).result).rejects.toBeInstanceOf(NotFoundException);
      }
    });
  });

  describe('dev routes', () => {
    const dev: Call = { method: 'POST', routeUrl: '/dev/fake/comments' };
    it('admit a member and set the org context only', async () => {
      const r = run(dev, { who: nobody });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['orgContext']).toMatchObject({ userId: nobody.userId });
      expect(r.req['authz']).toBeUndefined();
    });
    it('refuse a caller who is not a member of the active org', async () => {
      await expect(run(dev, { who: nobody, activeOrgId: owner.orgId }).result).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});

// ---- permission and project scope: real orgs, invitations and rows ----

describe('permission and project scope', () => {
  let t: TestApp;
  let orgA: string;
  let orgB: string;
  let owner: string; // org A owner
  let adm: string; // admin on P1 only, not the creator of P1
  let mem: string; // org-wide member
  let vw: string; // org-wide viewer
  let bob: string; // org B owner
  let p1: string;
  let p2: string;
  let pb: string; // a project of org B
  const people = {} as Record<'owner' | 'adm' | 'mem' | 'pm' | 'vw', Person>;
  const run1 = {} as Record<'mem' | 'other' | 'none' | 'pm', string>; // runs in P1 by owner
  let runP2: string;
  let ruleP1: string;
  let ruleP2: string;
  let agentP1: string;
  let agentB: string;
  let setupTestP1: string;

  const personOf = async (handle: string, orgId: string): Promise<Person> => ({
    userId: await userIdOf(t, handle),
    email: `${handle}@dev.local`,
    orgId,
  });
  const guard = (who: Person, call: Call, params: Record<string, unknown> = {}) => runGuard(t, call, { who, params });

  async function seedRun(orgId: string, projectId: string, ownerUserId: string | null, ref: string): Promise<string> {
    return withOrg(t.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(runs)
        .values({
          orgId,
          projectId,
          command: 'fix',
          skillName: 'fix',
          ticketRef: ref,
          ticketKind: 'issue',
          checkoutRef: 'refs/heads/main',
          triggerSource: 'webhook',
          ownerUserId,
        })
        .returning({ id: runs.id });
      if (!row) throw new Error('no run');
      return row.id;
    });
  }

  async function agentOf(cookie: string, projectId: string): Promise<string> {
    const res = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/agent`, headers: { cookie } });
    return (res.json() as { id: string }).id;
  }

  async function seedRule(orgId: string, projectId: string, agentId: string, command: string): Promise<string> {
    return withOrg(t.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(rulesTable)
        .values({ orgId, projectId, agentId, command, prompt: 'p', target: 'issue' })
        .returning({ id: rulesTable.id });
      if (!row) throw new Error('no rule');
      return row.id;
    });
  }

  beforeAll(async () => {
    t = await createTestApp({ env: { FAKE_STATE_DIR: freshStateDir() }, wrapAdapters: wideFakeRepos });
    orgA = (await createOrg(t, 'Scope A', 'scope-a')).id;
    orgB = (await createOrg(t, 'Scope B', 'scope-b')).id;
    owner = await inviteAndLogin(t, orgA, 'sc-owner', 'owner', { type: 'org' });
    bob = await inviteAndLogin(t, orgB, 'sc-bob', 'owner', { type: 'org' });
    const connA = await installFake(t, owner);
    p1 = (await makeProject(t, owner, connA)).projectId;
    p2 = (await makeProject(t, owner, connA)).projectId;
    pb = (await makeProject(t, bob, await installFake(t, bob))).projectId;
    adm = await inviteAndLogin(t, orgA, 'sc-adm', 'admin', { type: 'project', projectIds: [p1] });
    mem = await inviteAndLogin(t, orgA, 'sc-mem', 'member', { type: 'org' });
    await inviteAndLogin(t, orgA, 'sc-pm', 'member', { type: 'project', projectIds: [p1] });
    vw = await inviteAndLogin(t, orgA, 'sc-vw', 'viewer', { type: 'org' });
    people.owner = await personOf('sc-owner', orgA);
    people.adm = await personOf('sc-adm', orgA);
    people.mem = await personOf('sc-mem', orgA);
    people.pm = await personOf('sc-pm', orgA);
    people.vw = await personOf('sc-vw', orgA);
    run1.mem = await seedRun(orgA, p1, people.mem.userId, 'r-mem');
    run1.other = await seedRun(orgA, p1, people.owner.userId, 'r-other');
    run1.none = await seedRun(orgA, p1, null, 'r-none');
    run1.pm = await seedRun(orgA, p1, people.pm.userId, 'r-pm');
    runP2 = await seedRun(orgA, p2, people.owner.userId, 'r-p2');
    agentP1 = await agentOf(owner, p1);
    agentB = await agentOf(bob, pb);
    ruleP1 = await seedRule(orgA, p1, agentP1, 'one');
    ruleP2 = await seedRule(orgA, p2, await agentOf(owner, p2), 'two');
    setupTestP1 = await withOrg(t.db, orgA, async (tx) => {
      const [row] = await tx
        .insert(setupTests)
        .values({ orgId: orgA, projectId: p1, status: 'queued', scriptSha256: 'x', startedBy: people.pm.userId })
        .returning({ id: setupTests.id });
      if (!row) throw new Error('no setup test');
      return row.id;
    });
  });
  afterAll(async () => {
    await t.close();
  });

  const RANDOM = '5b0f5d6e-8f4e-4c55-9d52-0c2f3a9a1e11';
  const call = (method: string, routeUrl: string): Call => ({ method, routeUrl });
  const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

  describe('what the guard puts on the request', () => {
    it('project, owner and the access for a project route', async () => {
      const r = guard(people.owner, call('GET', '/api/projects/:projectId'), { projectId: p1 });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['authz']).toMatchObject({ routeKey: 'projects.get', projectId: p1 });
      expect((r.req['authz'] as { ownerUserId?: unknown }).ownerUserId).toBeUndefined();
    });
    it('the run owner for a run route, null when the run has none', async () => {
      const a = guard(people.owner, call('GET', '/api/runs/:runId'), { runId: run1.mem });
      await expect(a.result).resolves.toBe(true);
      expect(a.req['authz']).toMatchObject({ projectId: p1, ownerUserId: people.mem.userId });
      const b = guard(people.owner, call('GET', '/api/runs/:runId'), { runId: run1.none });
      await expect(b.result).resolves.toBe(true);
      expect(b.req['authz']).toMatchObject({ projectId: p1, ownerUserId: null });
    });
    it('the starter for a setup test route', async () => {
      const r = guard(people.adm, call('POST', '/api/setup-tests/:setupTestId/end'), { setupTestId: setupTestP1 });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['authz']).toMatchObject({ projectId: p1, ownerUserId: people.pm.userId });
    });
    it('the project of a rule and of an agent', async () => {
      const a = guard(people.adm, call('PATCH', '/api/rules/:ruleId'), { ruleId: ruleP1 });
      await expect(a.result).resolves.toBe(true);
      expect(a.req['authz']).toMatchObject({ projectId: p1 });
      const b = guard(people.adm, call('PUT', '/api/agents/:agentId/credential'), { agentId: agentP1 });
      await expect(b.result).resolves.toBe(true);
      expect(b.req['authz']).toMatchObject({ projectId: p1 });
    });
  });

  describe('project scope: out of scope is 404', () => {
    it('a project admin of P1 gets 404 on a P2 project, run, rule and a run of P2', async () => {
      const cases: [Call, Record<string, unknown>][] = [
        [call('GET', '/api/projects/:projectId'), { projectId: p2 }],
        [call('GET', '/api/runs/:runId'), { runId: runP2 }],
        [call('POST', '/api/runs/:runId/cancel'), { runId: runP2 }],
        [call('PATCH', '/api/rules/:ruleId'), { ruleId: ruleP2 }],
      ];
      for (const [c, params] of cases) {
        await expect(guard(people.adm, c, params).result, c.routeUrl).rejects.toBeInstanceOf(NotFoundException);
      }
    });
    it('a P1-only member gets 404 on a run of P2', async () => {
      await expect(guard(people.pm, call('GET', '/api/runs/:runId'), { runId: runP2 }).result).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
    it('org A callers get 404 for an org B project and agent (RLS), not 403', async () => {
      await expect(
        guard(people.owner, call('GET', '/api/projects/:projectId'), { projectId: pb }).result,
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        guard(people.owner, call('PUT', '/api/agents/:agentId/credential'), { agentId: agentB }).result,
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('run ownership', () => {
    const cancel = call('POST', '/api/runs/:runId/cancel');
    it('lets a member control their own run and refuses someone else’s and an ownerless one with 403', async () => {
      await expect(guard(people.pm, cancel, { runId: run1.pm }).result).resolves.toBe(true);
      await expect(guard(people.pm, cancel, { runId: run1.other }).result).rejects.toBeInstanceOf(ForbiddenException);
      await expect(guard(people.pm, cancel, { runId: run1.none }).result).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('lets a project admin control any run in the project', async () => {
      for (const id of [run1.mem, run1.other, run1.none]) {
        await expect(guard(people.adm, cancel, { runId: id }).result).resolves.toBe(true);
      }
    });
    it('lets a member read any run in scope (run:read is any)', async () => {
      await expect(guard(people.pm, call('GET', '/api/runs/:runId'), { runId: run1.other }).result).resolves.toBe(true);
    });
  });

  describe('permission is checked before the target is looked up (BR-6)', () => {
    it('a viewer gets 403 on a random rule id, a malformed one and a real rule with an invalid body', async () => {
      for (const id of [RANDOM, 'not-a-uuid', ruleP1]) {
        const res = await send(
          'PATCH',
          `/api/rules/${id}`,
          vw,
          id === ruleP1 ? { enabled: 'nope' } : { enabled: false },
        );
        expect(res.statusCode, id).toBe(403);
      }
    });
    it('a member gets 403 on another org’s agent credential', async () => {
      const res = await send('PUT', `/api/agents/${agentB}/credential`, mem, { type: 'api_key', value: 'x' });
      expect(res.statusCode).toBe(403);
    });
    it('a member gets 403 on connections, project create and project delete, whatever the id', async () => {
      expect((await send('GET', '/api/connections', mem)).statusCode).toBe(403);
      expect((await send('POST', '/api/projects', mem, {})).statusCode).toBe(403);
      expect((await send('DELETE', `/api/projects/${RANDOM}`, mem)).statusCode).toBe(403);
    });
  });

  describe('404 for the caller who may do the action (BR-7)', () => {
    it('A gets 404 for org B’s project and for a random rule id', async () => {
      expect((await send('GET', `/api/projects/${pb}`, adm)).statusCode).toBe(404);
      expect((await send('PATCH', `/api/rules/${RANDOM}`, adm, { enabled: false })).statusCode).toBe(404);
    });
    it('an owner gets 404 for a malformed project id', async () => {
      expect((await send('GET', '/api/projects/not-a-uuid', owner)).statusCode).toBe(404);
    });
  });

  describe('the 403 body (BR-12)', () => {
    it('says the action is not allowed, carries a requestId and names nothing of another org', async () => {
      const res = await send('PUT', `/api/agents/${agentB}/credential`, mem, { type: 'api_key', value: 'secret-x' });
      expect(res.statusCode).toBe(403);
      const body = res.json<{ detail: string; requestId?: string }>();
      expect(body.detail).toBe(FORBIDDEN_DETAIL);
      expect(typeof body.requestId).toBe('string');
      for (const leak of [agentB, pb, orgB, 'secret-x']) expect(res.body).not.toContain(leak);
    });
    it('a project admin gets 403 on connections', async () => {
      expect((await send('GET', '/api/connections', adm)).statusCode).toBe(403);
    });
  });

  describe('legacy creator or owner rule is gone', () => {
    it('a project admin who did not create P1 edits it, its setup script and starts a setup test', async () => {
      const patch = await send('PATCH', `/api/projects/${p1}`, adm, { pollIntervalSeconds: 600 });
      expect(patch.statusCode).toBeLessThan(300);
      const script = await send('PUT', `/api/projects/${p1}/setup-script`, adm, { body: 'echo hi', baseVersion: null });
      expect(script.statusCode).toBeLessThan(300);
      const test = await send('POST', `/api/projects/${p1}/setup-tests`, adm, { script: 'echo hi' });
      expect(test.statusCode).toBeLessThan(300);
    });
    it('a member can poll now: the permission passes (202, or the state 409)', async () => {
      const res = await send('POST', `/api/projects/${p1}/connection/poll`, mem);
      expect([202, 409]).toContain(res.statusCode);
    });
    it('a viewer cannot poll now', async () => {
      expect((await send('POST', `/api/projects/${p1}/connection/poll`, vw)).statusCode).toBe(403);
    });
  });

  describe('a refused write changes nothing (N4)', () => {
    const count = async (sqlText: string): Promise<number> => {
      const client = await t.db.pool.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.org_id', $1, true)", [orgA]);
        const res = await client.query<{ n: number }>(sqlText);
        await client.query('commit');
        return Number(res.rows[0]?.n);
      } finally {
        client.release();
      }
    };
    it('leaves no row, no audit row and no Temporal call', async () => {
      const rulesBefore = await count('select count(*)::int as n from rules');
      const auditBefore = await count('select count(*)::int as n from audit_log');
      t.temporal.reset();
      const res = await send('POST', `/api/projects/${p1}/rules`, vw, {
        kind: 'prompt',
        command: 'new-one',
        labelFilter: [],
        target: 'issue',
        prompt: 'p',
        enabled: true,
      });
      expect(res.statusCode).toBe(403);
      const poll = await send('POST', `/api/projects/${p1}/connection/poll`, vw);
      expect(poll.statusCode).toBe(403);
      expect(await count('select count(*)::int as n from rules')).toBe(rulesBefore);
      expect(await count('select count(*)::int as n from audit_log')).toBe(auditBefore);
      expect(t.temporal.calls).toEqual([]);
    });
  });
});

// ---- the denial table: every route, every kind of caller, the expected status written out here ----

/** The two WebSocket routes; they are checked by close code, not by an HTTP status. */
type TerminalKey = 'runs.terminal' | 'setupTests.terminal';
type HttpKey = Exclude<RouteKey, TerminalKey>;
const TERMINAL_ROWS: TerminalKey[] = ['runs.terminal', 'setupTests.terminal'];

/**
 * What each caller must get from a route, written from the spec's route table (never read back from `routeAccess`).
 * `none` is a member of the org with no assignment, `viewer` an org-wide viewer, `pa` a platform admin with no
 * membership anywhere. `'stream'` is a Server-Sent-Events route the viewer may open: it answers 200 and stays open.
 */
interface Expected {
  none: number;
  viewer: number | 'stream';
  pa: number;
}
const tenant = (viewer: Expected['viewer']): Expected => ({ none: 403, viewer, pa: 403 });
const platformRoute = (pa: number): Expected => ({ none: 403, viewer: 403, pa });

/** The viewer's six `*:read` permissions (project, agent, skill, rule, setup, run) are 200, everything else 403. */
const DENIAL_TABLE: Record<HttpKey, Expected> = {
  'connections.list': tenant(403),
  'connections.install': tenant(403),
  'connections.sync': tenant(403),
  'connections.repos': tenant(403),
  'projects.list': tenant(200),
  'projects.create': tenant(403),
  'projects.get': tenant(200),
  'projects.update': tenant(403),
  'projects.remove': tenant(403),
  'projects.connection': tenant(200),
  'projects.pollNow': tenant(403),
  'projects.ignored': tenant(200),
  'projects.events': tenant('stream'),
  'agents.get': tenant(200),
  'agents.put': tenant(403),
  'agents.putCredential': tenant(403),
  'agents.models': tenant(200),
  'skills.list': tenant(200),
  'skills.get': tenant(200),
  'skills.put': tenant(403),
  'skills.remove': tenant(403),
  'rules.list': tenant(200),
  'rules.create': tenant(403),
  'rules.update': tenant(403),
  'rules.promptPreview': tenant(200),
  'rules.remove': tenant(403),
  'setupScript.get': tenant(200),
  'setupScript.put': tenant(403),
  'setupScript.versions': tenant(200),
  'setupScript.version': tenant(200),
  'setup.plugins': tenant(200),
  'setupTests.create': tenant(403),
  'setupTests.latest': tenant(200),
  'setupTests.end': tenant(403),
  'setupTests.events': tenant('stream'),
  'runs.list': tenant(200),
  'runs.stats': tenant(200),
  'runs.byNumber': tenant(200),
  'runs.get': tenant(200),
  'runs.log': tenant(200),
  'runs.cancel': tenant(403),
  'runs.finish': tenant(403),
  'runs.resume': tenant(403),
  'runs.stop': tenant(403),
  'runs.transcript': tenant(200),
  'runs.events': tenant('stream'),
  // a member with no assignment may still read their own (empty) access; a platform admin has no active org
  'me.access': { none: 200, viewer: 200, pa: 403 },
  'roles.list': tenant(200),
  'members.list': tenant(403),
  'assignments.list': tenant(403),
  'assignments.create': tenant(403),
  'assignments.remove': tenant(403),
  'invitations.list': tenant(403),
  'invitations.create': tenant(403),
  'invitations.remove': tenant(403),
  'platform.createOrg': platformRoute(201),
  'platform.listOrgs': platformRoute(200),
  'platform.listProjects': platformRoute(200),
  'platform.listRoles': platformRoute(200),
  'platform.listMembers': platformRoute(200),
  'platform.listAssignments': platformRoute(200),
  'platform.createAssignment': platformRoute(201),
  'platform.removeAssignment': platformRoute(204),
  'platform.listInvitations': platformRoute(200),
  'platform.createInvitation': platformRoute(201),
  'platform.removeInvitation': platformRoute(204),
};

const isPlatformKey = (key: string): boolean => key.startsWith('platform.');
// Object.keys widens the key type to string; DENIAL_TABLE is complete by type, so its keys are exactly HttpKey
const ALL_KEYS = Object.keys(DENIAL_TABLE) as HttpKey[];
const TENANT_KEYS = ALL_KEYS.filter((k) => !isPlatformKey(k));
const PLATFORM_KEYS = ALL_KEYS.filter(isPlatformKey);

describe('denial table over every route, stream and terminal', () => {
  const ORIGIN = 'http://localhost:5173';
  const NO_ACTIVE_ORG = 'No active organization';
  const flat = flattenRoutes(routes);
  let t: TestApp;
  let base: string;
  let wsBase: string;
  let orgA: string;
  let orgB: string;
  let p1: string;
  let p2: string;
  let ownerCookie: string;
  let adminOnP1: string; // "A": admin on P1 only
  let viewerCookie: string;
  let noneCookie: string;
  let strayCookie: string; // a viewer of org A whose session points at org B
  let paCookie: string;
  let bodies: Partial<Record<RouteKey, object>>;
  /** Query strings a route needs to be valid (a fixed instant, never the clock). */
  const queries: Partial<Record<RouteKey, string>> = { 'runs.stats': '?since=2020-01-01T00:00:00.000Z' };
  let ids: Record<string, string>;
  let runTerminalId: string;
  let setupTerminalId: string;

  async function seedRun(ref: string): Promise<string> {
    return withOrg(t.db, orgA, async (tx) => {
      const [row] = await tx
        .insert(runs)
        .values({
          orgId: orgA,
          projectId: p1,
          command: 'fix',
          skillName: 'fix',
          ticketRef: ref,
          ticketKind: 'issue',
          checkoutRef: 'refs/heads/main',
          triggerSource: 'webhook',
          status: 'running',
        })
        .returning({ id: runs.id });
      if (!row) throw new Error('no run');
      return row.id;
    });
  }

  async function roleIdOf(orgId: string, key: string): Promise<string> {
    return withOrg(t.db, orgId, async (tx) => {
      const [row] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.orgId, orgId), eq(roles.key, key)));
      if (!row) throw new Error(`no role ${key}`);
      return row.id;
    });
  }

  /** What the refused writes must not change: each org's own tables, the organization table and the secret store. */
  async function snapshot(...orgIds: string[]): Promise<Record<string, number | string[]>> {
    const out: Record<string, number | string[]> = {};
    const client = await t.db.pool.connect();
    try {
      for (const orgId of orgIds) {
        await client.query('begin');
        await client.query("select set_config('app.org_id', $1, true)", [orgId]);
        for (const table of ['projects', 'rules', 'role_assignments', 'invitations', 'audit_log']) {
          const res = await client.query<{ n: number }>(`select count(*)::int as n from ${table}`);
          out[`${orgId}:${table}`] = Number(res.rows[0]?.n);
        }
        await client.query('commit');
      }
    } finally {
      client.release();
    }
    const orgs = await t.db.pool.query<{ n: number }>('select count(*)::int as n from organization');
    out['organization'] = Number(orgs.rows[0]?.n);
    out['secrets'] = t.secrets.names().sort();
    return out;
  }

  function urlOf(key: RouteKey, orgId = orgA): string {
    const def = flat[key];
    if (!def) throw new Error(`no route ${key}`);
    return def.path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
      if (name === 'orgId') return orgId;
      const v = ids[name];
      if (v === undefined) throw new Error(`no cast id for :${name} of ${key}`);
      return v;
    });
  }

  function call(key: HttpKey, cookie?: string, orgId = orgA) {
    const def = flat[key];
    if (!def) throw new Error(`no route ${key}`);
    const payload = bodies[key];
    return t.app.inject({
      method: def.method,
      url: `${urlOf(key, orgId)}${queries[key] ?? ''}`,
      headers: cookie === undefined ? {} : { cookie },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  /** Calls every route in `keys` as `cookie` and lists each one that did not answer the expected status. */
  async function mismatches(
    keys: HttpKey[],
    cookie: string | undefined,
    want: (key: HttpKey) => number,
    orgId = orgA,
    detail = FORBIDDEN_DETAIL,
  ): Promise<string[]> {
    const bad: string[] = [];
    for (const key of keys) {
      const res = await call(key, cookie, orgId);
      const expected = want(key);
      if (res.statusCode !== expected) {
        bad.push(`${key}: wanted ${expected}, got ${res.statusCode} ${res.body.slice(0, 200)}`);
      } else if (expected === 403 && res.json<{ detail?: string }>().detail !== detail) {
        bad.push(`${key}: 403 without the detail ${detail}: ${res.body.slice(0, 200)}`);
      }
    }
    return bad;
  }

  /** Opens a stream the caller may see, reads the status line and hangs up. */
  async function streamStatus(key: HttpKey, cookie: string): Promise<number> {
    const ac = new AbortController();
    try {
      const res = await fetch(`${base}${urlOf(key)}`, { headers: { cookie }, signal: ac.signal });
      await res.body?.cancel();
      return res.status;
    } finally {
      ac.abort();
    }
  }

  /** Connects a terminal socket and returns its close code and how many terminal bytes arrived before it. */
  async function terminal(path: string, cookie?: string): Promise<{ code: number; bytes: number }> {
    const ws = new WebSocket(`${wsBase}${path}`, {
      headers: { origin: ORIGIN, ...(cookie === undefined ? {} : { cookie }) },
    });
    let bytes = 0;
    ws.on('message', (d: Buffer, isBinary: boolean) => {
      if (isBinary) bytes += d.length;
    });
    ws.on('error', () => undefined);
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    return { code, bytes };
  }
  const terminalPaths = (): string[] => [
    `/api/runs/${runTerminalId}/terminal`,
    `/api/setup-tests/${setupTerminalId}/terminal`,
  ];

  beforeAll(async () => {
    t = await createTestApp({
      env: { FAKE_STATE_DIR: freshStateDir(), AGENT_MODELS_SOURCE: 'builtin' },
      wrapAdapters: wideFakeRepos,
    });
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = t.app.getHttpServer().address();
    if (typeof addr !== 'object' || addr === null) throw new Error('the test app is not listening on a TCP port');
    const port = addr.port;
    base = `http://127.0.0.1:${port}`;
    wsBase = `ws://127.0.0.1:${port}`;
    orgA = (await createOrg(t, 'Denial A', 'denial-a')).id;
    orgB = (await createOrg(t, 'Denial B', 'denial-b')).id;
    ownerCookie = await inviteAndLogin(t, orgA, 'dt-owner', 'owner', { type: 'org' });
    const connA = await installFake(t, ownerCookie);
    p1 = (await makeProject(t, ownerCookie, connA)).projectId;
    p2 = (await makeProject(t, ownerCookie, connA)).projectId;
    adminOnP1 = await inviteAndLogin(t, orgA, 'dt-a', 'admin', { type: 'project', projectIds: [p1] });
    viewerCookie = await inviteAndLogin(t, orgA, 'dt-viewer', 'viewer', { type: 'org' });
    strayCookie = await inviteAndLogin(t, orgA, 'dt-stray', 'viewer', { type: 'org' });
    noneCookie = await inviteAndLogin(t, orgA, 'dt-none', 'viewer', { type: 'org' });
    await inviteAndLogin(t, orgA, 'dt-spare', 'member', { type: 'project', projectIds: [p2] });
    paCookie = await asPlatformAdmin(t);

    // Off-list data: a member with no assignment cannot be made through the invitation flow.
    const noneId = await userIdOf(t, 'dt-none');
    await withOrg(t.db, orgA, (tx) => tx.delete(roleAssignments).where(eq(roleAssignments.userId, noneId)));
    // "dt-stray" is a member of org A whose session points at org B, which they do not belong to (BR-8).
    await t.db.pool.query(
      `update session set active_organization_id = $1 where user_id = (select id from "user" where email = 'dt-stray@dev.local')`,
      [orgB],
    );

    const send = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
      t.app.inject({ method, url, headers: { cookie: ownerCookie }, ...(payload === undefined ? {} : { payload }) });
    const agentId = (await send('GET', `/api/projects/${p1}/agent`)).json<{ id: string }>().id;
    const rule = await send('POST', `/api/projects/${p1}/rules`, {
      kind: 'prompt',
      command: 'seeded',
      labelFilter: [],
      target: 'issue',
      prompt: 'p',
      enabled: true,
    });
    expect(rule.statusCode).toBe(201);
    const skill = await send('PUT', `/api/projects/${p1}/skills/fix`, {
      body: '---\ndescription: Fix\n---\nDo it.\n',
      message: 'seed',
    });
    expect(skill.statusCode).toBe(200);
    const script = await send('PUT', `/api/projects/${p1}/setup-script`, { body: 'echo hi', baseVersion: null });
    expect(script.statusCode).toBeLessThan(300);
    const runId = await seedRun('dt-run');
    runTerminalId = runId;
    setupTerminalId = await withOrg(t.db, orgA, async (tx) => {
      const [row] = await tx
        .insert(setupTests)
        .values({ orgId: orgA, projectId: p1, status: 'running', scriptSha256: 'x', startedBy: noneId })
        .returning({ id: setupTests.id });
      if (!row) throw new Error('no setup test');
      return row.id;
    });

    // A grant and an invitation the remove routes can point at; both are real rows of org A.
    const memberRole = await roleIdOf(orgA, 'member');
    const viewerRole = await roleIdOf(orgA, 'viewer');
    const spareId = await userIdOf(t, 'dt-spare');
    const assignments = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${orgA}/assignments`,
      headers: { cookie: paCookie },
    });
    const spareAssignment = assignments
      .json<{ items: { id: string; userId: string }[] }>()
      .items.find((a) => a.userId === spareId);
    if (!spareAssignment) throw new Error('no assignment for the spare member');
    const invite = await t.app.inject({
      method: 'POST',
      url: `/api/platform/orgs/${orgA}/invitations`,
      headers: { cookie: paCookie },
      payload: { email: 'dt-pending@dev.local', roleId: viewerRole, scope: { type: 'org' } },
    });
    expect(invite.statusCode).toBe(201);

    ids = {
      projectId: p1,
      runId,
      ruleId: rule.json<{ id: string }>().id,
      agentId,
      setupTestId: setupTerminalId,
      assignmentId: spareAssignment.id,
      invitationId: invite.json<{ id: string }>().id,
      connectionId: connA,
      provider: 'fake',
      name: 'fix',
      version: '1',
      number: '1',
    };
    bodies = {
      'projects.create': { connectionId: connA, repoPath: 'dev/p-denied', triggerMode: 'webhook' },
      'projects.update': { pollIntervalSeconds: 600 },
      'agents.put': { model: 'claude-opus-4-1', timeoutSeconds: 3600 },
      'agents.putCredential': { type: 'api_key', value: 'denial-table-secret' },
      'skills.put': { body: '---\ndescription: Denied\n---\nDenied.\n', message: 'denied' },
      'rules.create': {
        kind: 'prompt',
        command: 'denied-rule',
        labelFilter: [],
        target: 'issue',
        prompt: 'denied',
        enabled: true,
      },
      'rules.update': { enabled: false },
      'setupScript.put': { body: 'echo denied', baseVersion: null },
      'setupTests.create': { script: 'echo denied' },
      'assignments.create': { userId: spareId, roleId: memberRole, scope: { type: 'project', projectId: p1 } },
      'invitations.create': { email: 'dt-denied@dev.local', roleId: viewerRole, scope: { type: 'org' } },
      'platform.createOrg': { name: 'Denial New', slug: 'denial-new' },
      'platform.createAssignment': { userId: spareId, roleId: memberRole, scope: { type: 'project', projectId: p1 } },
      'platform.createInvitation': { email: 'dt-denied@dev.local', roleId: viewerRole, scope: { type: 'org' } },
    };
    t.temporal.reset();
  });
  afterAll(async () => {
    await t.close();
  });

  it('N3: the table has a row for every route key and no other, and every key is in routeAccess', () => {
    const table = [...ALL_KEYS, ...TERMINAL_ROWS].sort();
    expect(table).toEqual(Object.keys(flat).sort());
    expect(table).toEqual(Object.keys(routeAccess).sort());
  });

  it('no session gets 401 on every route and 4401 on both terminals', async () => {
    expect(await mismatches(ALL_KEYS, undefined, () => 401)).toEqual([]);
    for (const path of terminalPaths()) expect(await terminal(path)).toEqual({ code: 4401, bytes: 0 });
  });

  it('a member with no assignment gets 403 everywhere except their own access (200)', async () => {
    expect(await mismatches(ALL_KEYS, noneCookie, (k) => DENIAL_TABLE[k].none)).toEqual([]);
    expect((await call('me.access', noneCookie)).json()).toMatchObject({ assignments: [] });
  });

  it('a viewer gets 403 on every write and on every read a viewer may not do', async () => {
    const writes = ALL_KEYS.filter((k) => flat[k]?.method !== 'GET');
    expect(writes.length).toBeGreaterThan(25);
    expect(writes.filter((k) => DENIAL_TABLE[k].viewer !== 403)).toEqual([]); // no write is open to a viewer
    const refused = ALL_KEYS.filter((k) => DENIAL_TABLE[k].viewer === 403);
    expect(await mismatches(refused, viewerCookie, () => 403)).toEqual([]);
  });

  it('both terminals close 4403 for the viewer and the member with no assignment, before any terminal byte', async () => {
    for (const cookie of [viewerCookie, noneCookie]) {
      for (const path of terminalPaths()) expect(await terminal(path, cookie)).toEqual({ code: 4403, bytes: 0 });
    }
  });

  it('the org owner and A get 403 on every platform route, createOrg included (BR-70)', async () => {
    for (const cookie of [ownerCookie, adminOnP1]) {
      expect(await mismatches(PLATFORM_KEYS, cookie, () => 403)).toEqual([]);
    }
  });

  it('a platform admin with no membership gets 403 on every tenant route and on both terminals, under either org', async () => {
    // no membership means no active org: the guard says so (session.guard.ts) rather than the role message
    expect(await mismatches(TENANT_KEYS, paCookie, (k) => DENIAL_TABLE[k].pa, orgA, NO_ACTIVE_ORG)).toEqual([]);
    expect(await mismatches(TENANT_KEYS, paCookie, (k) => DENIAL_TABLE[k].pa, orgB, NO_ACTIVE_ORG)).toEqual([]);
    for (const path of terminalPaths()) expect(await terminal(path, paCookie)).toEqual({ code: 4403, bytes: 0 });
  });

  it('BR-38: the platform admin gets no data from the tenant project, member, invitation and assignment lists', async () => {
    for (const key of ['projects.list', 'members.list', 'invitations.list', 'assignments.list'] as const) {
      const res = await call(key, paCookie);
      expect(res.statusCode, key).toBe(403);
      for (const leak of [p1, p2, 'dt-owner', 'dt-pending', 'items']) expect(res.body, key).not.toContain(leak);
    }
  });

  it('BR-8: a signed-in user whose active org is not theirs gets 403 on every route and 4403 on both terminals', async () => {
    expect(await mismatches(ALL_KEYS, strayCookie, () => 403)).toEqual([]);
    expect(await mismatches(TENANT_KEYS, strayCookie, () => 403, orgB)).toEqual([]);
    for (const path of terminalPaths()) expect(await terminal(path, strayCookie)).toEqual({ code: 4403, bytes: 0 });
  });

  it('N4: after every refused request there is no new row, no secret written and no Temporal call', async () => {
    // runs the refused requests itself, so it does not depend on the order of the other tests
    t.temporal.reset();
    const before = await snapshot(orgA, orgB);
    expect(await mismatches(ALL_KEYS, undefined, () => 401)).toEqual([]);
    expect(await mismatches(ALL_KEYS, noneCookie, (k) => DENIAL_TABLE[k].none)).toEqual([]);
    expect(
      await mismatches(
        ALL_KEYS.filter((k) => DENIAL_TABLE[k].viewer === 403),
        viewerCookie,
        () => 403,
      ),
    ).toEqual([]);
    expect(await mismatches(PLATFORM_KEYS, ownerCookie, () => 403)).toEqual([]);
    expect(await mismatches(TENANT_KEYS, paCookie, (k) => DENIAL_TABLE[k].pa, orgA, NO_ACTIVE_ORG)).toEqual([]);
    // the stray session points at org B: a write that got through would land there
    expect(await mismatches(ALL_KEYS, strayCookie, () => 403)).toEqual([]);
    expect(await mismatches(TENANT_KEYS, strayCookie, () => 403, orgB)).toEqual([]);
    expect(await snapshot(orgA, orgB)).toEqual(before);
    expect(t.temporal.calls).toEqual([]);
    expect(t.secrets.names()).not.toContain('denial-table-secret');
  });

  it('the viewer reads what a viewer may (200) and opens the streams it may', async () => {
    const reads = ALL_KEYS.filter((k) => typeof DENIAL_TABLE[k].viewer === 'number' && DENIAL_TABLE[k].viewer !== 403);
    expect(reads.length).toBeGreaterThan(20);
    expect(await mismatches(reads, viewerCookie, (k) => Number(DENIAL_TABLE[k].viewer))).toEqual([]);
    for (const key of ALL_KEYS.filter((k) => DENIAL_TABLE[k].viewer === 'stream')) {
      expect(await streamStatus(key, viewerCookie), key).toBe(200);
    }
  });

  it('/dev/fake/posted answers with a session and 401 without', async () => {
    const url = '/dev/fake/posted?repoPath=dev%2Fp-1';
    expect((await t.app.inject({ method: 'GET', url, headers: { cookie: viewerCookie } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url })).statusCode).toBe(401);
  });

  it('the platform admin gets the written 2xx on every platform route', async () => {
    // the remove routes run last: they take the rows the earlier list and create routes read
    const order = [
      ...PLATFORM_KEYS.filter((k) => !k.startsWith('platform.remove')),
      ...PLATFORM_KEYS.filter((k) => k.startsWith('platform.remove')),
    ];
    expect(await mismatches(order, paCookie, (k) => DENIAL_TABLE[k].pa)).toEqual([]);
  });

  it('N2: removing project:create from org A’s admin role changes org A admins only', async () => {
    const a = await createOrg(t, 'Role Edit A', 'role-edit-a');
    const b = await createOrg(t, 'Role Edit B', 'role-edit-b');
    const adminA = await inviteAndLogin(t, a.id, 'n2-admin-a', 'admin', { type: 'org' });
    const adminB = await inviteAndLogin(t, b.id, 'n2-admin-b', 'admin', { type: 'org' });
    const connA = await installFake(t, adminA);
    const connB = await installFake(t, adminB);
    const create = (cookie: string, connectionId: string, repoPath: string) =>
      t.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { cookie },
        payload: { connectionId, repoPath, triggerMode: 'webhook' },
      });
    expect((await create(adminA, connA, 'dev/p-10')).statusCode).toBe(201);

    const adminRole = await roleIdOf(a.id, 'admin');
    // The owner of the schema edits the role data (no API edits roles in this slice).
    const owner = new pg.Pool({ connectionString: t.pg.ownerUrl, max: 1 });
    try {
      // role_permissions is row-level secured even for its owner, so the edit runs in the org's own scope
      await owner.query('begin');
      await owner.query("select set_config('app.org_id', $1, true)", [a.id]);
      const del = await owner.query(
        "delete from role_permissions where role_id = $1 and permission = 'project:create'",
        [adminRole],
      );
      await owner.query('commit');
      expect(del.rowCount).toBe(1);
    } finally {
      await owner.end();
    }

    expect((await create(adminA, connA, 'dev/p-11')).statusCode).toBe(403);
    expect((await create(adminB, connB, 'dev/p-10')).statusCode).toBe(201);
    // org A's admin keeps every other permission
    const list = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: adminA } });
    expect(list.statusCode).toBe(200);
  });
});
