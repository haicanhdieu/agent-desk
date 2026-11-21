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
import { copyRoleTemplates } from '@agentdesk/core';
import { roleAssignments, roles, withOrg } from '@agentdesk/db';
import { and, eq } from 'drizzle-orm';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { routeEntryFor } from '../src/access/route-entry';
import type { Auth } from '../src/auth/auth';
import { SessionGuard } from '../src/auth/session.guard';
import type { Config } from '../src/config/config.module';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';

/**
 * Route keys whose controllers are added by later tasks of the RBAC plan. Each entry is asserted to be still
 * unregistered, so the task that adds the controller must delete its line here.
 */
const NOT_REGISTERED_YET: RouteKey[] = [
  'members.list',
  'platform.listMembers',
  'platform.listAssignments',
  'platform.createAssignment',
  'platform.removeAssignment',
];

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
      const cookie = await loginAs(t, 'probe');
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

describe('SessionGuard route kinds', () => {
  let t: TestApp;
  let nobody: Person; // member of an org, no assignment
  let owner: Person; // org-scope owner of their org
  let viewer: Person; // org-scope viewer of their org

  async function person(handle: string): Promise<Person> {
    await loginAs(t, handle);
    const r = await t.db.pool.query<{ id: string; organization_id: string }>(
      `select u.id, m.organization_id from "user" u join member m on m.user_id = u.id where u.handle = $1`,
      [handle],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`no user ${handle}`);
    return { userId: row.id, email: `${handle}@dev.local`, orgId: row.organization_id };
  }

  async function assign(p: Person, roleKey: string): Promise<void> {
    await withOrg(t.db, p.orgId, async (tx) => {
      await copyRoleTemplates(tx, p.orgId);
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.orgId, p.orgId), eq(roles.key, roleKey)));
      if (!role) throw new Error(`no role ${roleKey}`);
      await tx.insert(roleAssignments).values({ orgId: p.orgId, userId: p.userId, roleId: role.id, scopeType: 'org' });
    });
  }

  beforeAll(async () => {
    t = await createTestApp();
    nobody = await person('az-nobody');
    owner = await person('az-owner');
    viewer = await person('az-viewer');
    await assign(owner, 'owner');
    await assign(viewer, 'viewer');
  });
  afterAll(async () => {
    await t.close();
  });

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

  function run(call: Call, opts: Opts) {
    const denies: { obj: Record<string, unknown>; msg: string }[] = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => denies.push({ obj, msg }),
    } as unknown as Logger; // only the info level is used by the guard
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

  describe('org, project and project-list routes (enforced by a later task)', () => {
    it('still pass for a member, with the route key and access on the request', async () => {
      const r = run({ method: 'GET', routeUrl: '/api/projects/:projectId' }, { who: nobody });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['authz']).toMatchObject({ routeKey: 'projects.get', access: { userId: nobody.userId } });
      await expect(run({ method: 'GET', routeUrl: '/api/projects' }, { who: nobody }).result).resolves.toBe(true);
      await expect(run({ method: 'POST', routeUrl: '/api/projects' }, { who: nobody }).result).resolves.toBe(true);
    });
    it('map the install callback to connections.install', async () => {
      const r = run({ method: 'GET', routeUrl: '/api/connections/:provider/callback' }, { who: nobody });
      await expect(r.result).resolves.toBe(true);
      expect(r.req['authz']).toMatchObject({ routeKey: 'connections.install' });
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
