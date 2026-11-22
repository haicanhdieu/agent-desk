import { randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import {
  AccessDto,
  CreateOrgResponse,
  InvitationDto,
  PlatformMemberDto,
  PlatformOrgDto,
  PlatformProjectDto,
  PlatformRoleDto,
  ProjectDto,
  pageOf,
} from '@agentdesk/contracts';
import { z } from 'zod';
import { API, acceptViaApi, asPlatformAdmin, createOrg, ok } from './helpers';
import { REPO_P1, REPO_P2, buildCast, disposeCast, installFake, type Actor, type Cast } from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, the platform admin (spec "E2E requirements": BR-38, BR-40, BR-69, BR-70). PA is
 * the seeded platform admin (`admin@dev.local`); the cast is the spec's: O owner, D admin on the org, A admin on P1,
 * B member on P1 and P2, C member on P1, V viewer on the org; P1 and P2 are its projects.
 *
 * Every case that uses the cast only reads, or is refused, so one cast serves the BR-38, BR-40 and BR-70 cases of a
 * worker (built in `beforeAll`, disposed in `afterAll`): a fresh cast per case would start three runs and six browsers
 * 12 times for no change of state. The BR-69 cases need no cast: each makes its own org with a random tag. Orgs cannot
 * be deleted, so every org a case creates has a unique slug; the one project a case creates is removed in a `finally`,
 * and every cleanup error is swallowed so it never masks a failure.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const tagOf = (): string => randomBytes(4).toString('hex');

// ---- Reading platform lists ----

const OrgPage = pageOf(PlatformOrgDto);
const ProjectPage = pageOf(PlatformProjectDto);
const MemberPage = pageOf(PlatformMemberDto);
const RawItems = z.object({ items: z.array(z.record(z.string(), z.unknown())) });
const RawList = z.array(z.record(z.string(), z.unknown()));

/** The sorted key names of a raw JSON object: DTO parsing drops unknown keys, so exact key sets are read from the raw body. */
const keysOf = (raw: Record<string, unknown>): string[] => Object.keys(raw).sort();

/** `scope` as a short string: `org` or `project:<id>`. */
const scopeText = (scope: { type: 'org' } | { type: 'project'; projectId: string }): string =>
  scope.type === 'org' ? 'org' : `project:${scope.projectId}`;

async function expectStatus(res: APIResponse, status: number, what: string): Promise<void> {
  expect(res.status(), `${what}: ${res.status()} ${await res.text()}`).toBe(status);
}

/** Every org the platform lists, newest first (all pages: orgs cannot be deleted, so the list only grows). */
async function listAllOrgs(pa: APIRequestContext): Promise<{ orgs: PlatformOrgDto[]; raw: Record<string, unknown>[] }> {
  const orgs: PlatformOrgDto[] = [];
  const raw: Record<string, unknown>[] = [];
  for (let page = 1; ; page++) {
    const body = await ok(await pa.get(`/api/platform/orgs?pageSize=100&page=${page}`), 200, 'platform orgs');
    const typed = OrgPage.parse(body);
    orgs.push(...typed.items);
    raw.push(...RawItems.parse(body).items);
    if (typed.items.length === 0 || orgs.length >= typed.total) break;
  }
  return { orgs, raw };
}

/** `GET /api/platform/orgs/:orgId/projects`, 200 only. */
async function platformProjects(
  pa: APIRequestContext,
  orgId: string,
): Promise<{ page: z.infer<typeof ProjectPage>; raw: Record<string, unknown>[] }> {
  const body = await ok(await pa.get(`/api/platform/orgs/${orgId}/projects?pageSize=100`), 200, 'platform projects');
  return { page: ProjectPage.parse(body), raw: RawItems.parse(body).items };
}

/** `GET /api/platform/orgs/:orgId/members`, 200 only. */
async function platformMembers(
  pa: APIRequestContext,
  orgId: string,
): Promise<{ page: z.infer<typeof MemberPage>; raw: Record<string, unknown>[] }> {
  const body = await ok(await pa.get(`/api/platform/orgs/${orgId}/members?pageSize=100`), 200, 'platform members');
  return { page: MemberPage.parse(body), raw: RawItems.parse(body).items };
}

/** `GET /api/platform/orgs/:orgId/roles`, 200 only. */
async function platformRoles(
  pa: APIRequestContext,
  orgId: string,
): Promise<{ roles: PlatformRoleDto[]; raw: Record<string, unknown>[] }> {
  const body = await ok(await pa.get(`/api/platform/orgs/${orgId}/roles`), 200, 'platform roles');
  return { roles: z.array(PlatformRoleDto).parse(body), raw: RawList.parse(body) };
}

/** The org's roles by key (the platform route), for the invitation's role id. */
async function roleIdOf(pa: APIRequestContext, orgId: string, key: string): Promise<string> {
  const found = (await platformRoles(pa, orgId)).roles.find((r) => r.key === key);
  expect(found, `org ${orgId} has no role ${key}`).toBeTruthy();
  return found?.id ?? '';
}

// ---- The cast ----

/** The cast shared by the BR-38, BR-40 and BR-70 cases (they only read or are refused). */
let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal. */
let built: Cast | undefined;
/** The cast's projects as the owner sees them (id, name, repository), for the "names nothing" and name checks. */
let projects: ProjectDto[] = [];

const castActors = (c: Cast): Actor[] => [c.o, c.d, c.a, c.b, c.c, c.v];
const emailOf = (who: Actor): string => `${who.handle.toLowerCase()}@dev.local`;

/** What a refused or empty answer to the platform admin must not name: the cast's projects, runs and people. */
function castLeaks(c: Cast): string[] {
  return [
    c.p1,
    c.p2,
    c.rb,
    c.rc,
    c.rp2,
    REPO_P1,
    REPO_P2,
    ...projects.map((p) => p.name),
    ...castActors(c).flatMap((a) => [a.userId, a.handle, emailOf(a)]),
  ];
}

/** A refusal (403 or 404, Q7 of the spec) that carries no data: no items, and none of the cast's ids, names, handles or emails. */
async function expectRefusedNoData(res: APIResponse, what: string): Promise<void> {
  const text = await res.text();
  expect([403, 404], `${what}: ${res.status()} ${text}`).toContain(res.status());
  const json = z
    .string()
    .transform((t) => {
      try {
        return JSON.parse(t) as unknown;
      } catch {
        return null;
      }
    })
    .parse(text);
  const items = z.object({ items: z.array(z.unknown()) }).safeParse(json);
  expect(items.success ? items.data.items : [], `${what}: the body lists items: ${text}`).toEqual([]);
  for (const leak of castLeaks(cast)) {
    expect(text, `${what}: the body names ${leak}`).not.toContain(leak);
  }
}

/** A 403 that carries no data of the cast (see `expectRefusedNoData`), exactly 403. */
async function expect403NoData(res: APIResponse, what: string): Promise<void> {
  await expectStatus(res, 403, what);
  await expectRefusedNoData(res, what);
}

test.describe('platform admin and the cast', () => {
  test.beforeAll(async ({ browser }) => {
    built = undefined;
    built = await buildCast(browser);
    cast = built;
    const list = pageOf(ProjectDto).parse(
      await ok(await cast.o.api.get('/api/projects?pageSize=100'), 200, 'O lists projects'),
    );
    projects = list.items;
    expect(projects.map((p) => p.id).sort(), 'the cast has exactly P1 and P2').toEqual([cast.p1, cast.p2].sort());
  });

  test.afterAll(async () => {
    const done = built;
    built = undefined;
    if (done) await disposeCast(done);
  });

  test.describe('BR-38: platform admin has no tenant data without an assignment', () => {
    test('TC-38.1: PA gets no project from the tenant project list of org X (403 or 404)', async () => {
      await expectRefusedNoData(await cast.pa.get('/api/projects?pageSize=100'), 'PA projects.list');
    });

    test('TC-38.2: PA is refused the tenant member and assignment lists of org X (403 or 404, no data)', async () => {
      await expectRefusedNoData(await cast.pa.get(`/api/orgs/${cast.orgId}/members?pageSize=100`), 'PA members');
      await expectRefusedNoData(
        await cast.pa.get(`/api/orgs/${cast.orgId}/assignments?pageSize=100`),
        'PA assignments',
      );
    });

    test('TC-38.3: PA is refused the tenant invitation list of org X (403 or 404, no data)', async () => {
      await expectRefusedNoData(
        await cast.pa.get(`/api/orgs/${cast.orgId}/invitations?pageSize=100`),
        'PA invitations',
      );
    });

    test('TC-38.4: PA reads the ids and names of P1 and P2 and the members of org X on the platform routes (200)', async () => {
      const { orgId, pa, p1, p2 } = cast;
      const listed = await platformProjects(pa, orgId);
      expect(listed.page.total, 'two projects').toBe(2);
      const byId = new Map(listed.page.items.map((p) => [p.id, p.name]));
      expect([...byId.keys()].sort(), 'the projects of org X').toEqual([p1, p2].sort());
      for (const project of projects) {
        expect(byId.get(project.id), `the name of ${project.id}`).toBe(project.name);
      }

      const members = await platformMembers(pa, orgId);
      expect(members.page.total, 'the org has six members').toBe(6);
      expect(members.page.items.map((m) => m.userId).sort(), "the org's members").toEqual(
        castActors(cast)
          .map((a) => a.userId)
          .sort(),
      );
    });
  });

  test.describe('BR-40: platform lists show ids, names, roles and scopes only', () => {
    test('TC-40.1: the org list entry for X shows id, name, slug, member count and creation time and nothing else', async () => {
      const { pa, orgId, slug } = cast;
      const { orgs, raw } = await listAllOrgs(pa);
      const entry = orgs.find((o) => o.id === orgId);
      expect(entry, `org ${orgId} is listed`).toBeTruthy();
      expect(entry?.slug, 'slug').toBe(slug);
      expect(entry?.name, 'name').toBe(`RBAC ${slug.replace(/^rbac-/, '')}`);
      expect(entry?.memberCount, 'member count: O, D, A, B, C and V, not PA').toBe(6);
      expect(Number.isNaN(Date.parse(entry?.createdAt ?? '')), 'creation time is a date').toBe(false);

      const rawEntry = raw.find((o) => o['id'] === orgId);
      expect(keysOf(rawEntry ?? {}), 'exact keys of an org entry').toEqual(
        ['createdAt', 'id', 'memberCount', 'name', 'slug'].sort(),
      );
      const text = JSON.stringify(rawEntry);
      for (const leak of [cast.p1, cast.p2, cast.rb, cast.rc, cast.rp2, REPO_P1, REPO_P2]) {
        expect(text, `the entry names ${leak}`).not.toContain(leak);
      }
    });

    test('TC-40.2: the org project list shows P1 and P2 with id and name only', async () => {
      const { pa, orgId, p1, p2 } = cast;
      const { page, raw } = await platformProjects(pa, orgId);
      expect(page.items.map((p) => p.id).sort(), 'P1 and P2').toEqual([p1, p2].sort());
      expect(raw, 'two entries').toHaveLength(2);
      for (const entry of raw) {
        expect(keysOf(entry), 'exact keys of a project entry').toEqual(['id', 'name']);
      }
      const text = JSON.stringify(raw);
      for (const leak of [cast.rb, cast.rc, cast.rp2, 'repoPath', 'agent', 'triggerMode']) {
        expect(text, `the list names ${leak}`).not.toContain(leak);
      }
    });

    test('TC-40.3: the org member list shows user id, handle, name, email and assignments only', async () => {
      const { pa, orgId, p1, p2, o, d, a, b, c, v } = cast;
      const { page, raw } = await platformMembers(pa, orgId);
      const expected = new Map<string, string[]>([
        [o.userId, ['owner:org']],
        [d.userId, ['admin:org']],
        [a.userId, [`admin:project:${p1}`]],
        [b.userId, [`member:project:${p1}`, `member:project:${p2}`]],
        [c.userId, [`member:project:${p1}`]],
        [v.userId, ['viewer:org']],
      ]);
      expect(page.items, 'six members').toHaveLength(6);
      for (const who of castActors(cast)) {
        const member = page.items.find((m) => m.userId === who.userId);
        expect(member, `${who.handle} is listed`).toBeTruthy();
        expect(member?.handle, `${who.handle}: handle`).toBe(who.handle);
        expect(member?.email, `${who.handle}: email`).toBe(emailOf(who));
        expect(member?.name.length ?? 0, `${who.handle}: name`).toBeGreaterThan(0);
        expect(
          (member?.assignments ?? []).map((x) => `${x.role.key}:${scopeText(x.scope)}`).sort(),
          `${who.handle}: assignments (role and scope)`,
        ).toEqual([...(expected.get(who.userId) ?? [])].sort());
      }

      for (const entry of raw) {
        expect(keysOf(entry), 'exact keys of a member entry').toEqual(
          ['assignments', 'email', 'handle', 'name', 'userId'].sort(),
        );
        for (const assignment of RawList.parse(entry['assignments'])) {
          expect(keysOf(assignment), 'exact keys of an assignment').toEqual(
            ['grantedAt', 'grantedBy', 'id', 'role', 'scope', 'userId'].sort(),
          );
        }
      }
      const text = JSON.stringify(raw);
      for (const leak of [REPO_P1, REPO_P2, cast.rb, cast.rc, cast.rp2, 'sk-ant', 'credential', 'secret']) {
        expect(text, `the list names ${leak}`).not.toContain(leak);
      }
      for (const project of projects) {
        expect(text, `the list names the project ${project.name}`).not.toContain(`"${project.name}"`);
      }
    });

    test('TC-40.4: the org role list shows the built-in roles with their permission lines', async () => {
      const { pa, orgId } = cast;
      const { roles, raw } = await platformRoles(pa, orgId);
      for (const entry of raw) {
        expect(keysOf(entry), 'exact keys of a role entry').toEqual(
          ['assignableScopes', 'builtIn', 'id', 'key', 'name', 'permissions'].sort(),
        );
        for (const line of RawList.parse(entry['permissions'])) {
          expect(keysOf(line), 'exact keys of a permission line').toEqual(['condition', 'permission']);
        }
      }
      const builtIn = roles.filter((r) => r.builtIn);
      expect(builtIn.map((r) => r.key).sort(), 'the built-in roles').toEqual(['admin', 'member', 'owner', 'viewer']);

      const lines = (key: string): string[] =>
        (builtIn.find((r) => r.key === key)?.permissions ?? []).map((l) => `${l.permission}:${l.condition}`).sort();
      // Issue 216: member and viewer hold no Desk reads (agent, skill, rule, setup).
      const reads = ['project:read', 'run:read'];
      expect(lines('viewer'), 'viewer: the two read permissions with any').toEqual(reads.map((p) => `${p}:any`).sort());
      expect(lines('member'), 'member').toEqual(
        [
          ...reads.map((p) => `${p}:any`),
          'run:create:any',
          'run:update:own',
          'run:cancel:own',
          'terminal:attach:own',
        ].sort(),
      );
      const owner = lines('owner');
      const admin = lines('admin');
      expect(owner, 'owner holds all 33 tenant permissions').toHaveLength(33);
      expect(
        owner.every((l) => l.endsWith(':any') && !l.startsWith('platform-')),
        'owner: any, tenant permissions only',
      ).toBe(true);
      expect(owner, 'owner holds org:delete').toContain('org:delete:any');
      expect(admin, 'admin holds all but org:delete').toEqual(owner.filter((l) => l !== 'org:delete:any'));
      for (const key of ['owner', 'admin', 'member', 'viewer']) {
        expect(
          lines(key).some((l) => l.startsWith('platform-')),
          `${key} holds no platform permission`,
        ).toBe(false);
      }
    });
  });

  test.describe('BR-70: non-platform-admins refused on org creation', () => {
    /** Every org PA lists that carries `slug`. */
    async function orgsWithSlug(slug: string): Promise<PlatformOrgDto[]> {
      return (await listAllOrgs(cast.pa)).orgs.filter((o) => o.slug === slug);
    }

    test('TC-70.1: O creating an org gets 403 and no org with that slug is listed', async () => {
      const slug = `e2e-${tagOf()}`;
      const res = await cast.o.api.post('/api/platform/orgs', { data: { name: `E2E ${slug}`, slug } });
      await expectStatus(res, 403, 'O creates an org');
      expect(await orgsWithSlug(slug), 'no org with that slug is listed').toEqual([]);
    });

    test('TC-70.2: A creating an org gets 403', async () => {
      const slug = `e2e-${tagOf()}`;
      const res = await cast.a.api.post('/api/platform/orgs', { data: { name: `E2E ${slug}`, slug } });
      await expectStatus(res, 403, 'A creates an org');
      expect(await orgsWithSlug(slug), 'no org with that slug is listed').toEqual([]);
    });

    test('TC-70.3: O gets 403 on the org list and on the member and invitation lists of org X', async () => {
      const { o, orgId } = cast;
      await expect403NoData(await o.api.get('/api/platform/orgs?pageSize=100'), 'O lists orgs');
      await expect403NoData(await o.api.get(`/api/platform/orgs/${orgId}/members?pageSize=100`), 'O lists members');
      await expect403NoData(
        await o.api.get(`/api/platform/orgs/${orgId}/invitations?pageSize=100`),
        'O lists invitations',
      );
    });

    test("TC-70.4: O granting C viewer on the org on the platform route gets 403 and C's access is unchanged", async () => {
      const { o, c, orgId, pa, p1 } = cast;
      const accessOf = async (): Promise<AccessDto> =>
        AccessDto.parse(await ok(await c.api.get('/api/me/access'), 200, 'C access'));
      const before = await accessOf();
      expect(
        before.assignments.map((x) => `${x.roleKey}:${scopeText(x.scope)}`),
        'C starts as member on P1',
      ).toEqual([`member:project:${p1}`]);

      const viewerId = await roleIdOf(pa, orgId, 'viewer');
      const res = await o.api.post(`/api/platform/orgs/${orgId}/assignments`, {
        data: { userId: c.userId, roleId: viewerId, scope: { type: 'org' } },
      });
      await expectStatus(res, 403, 'O grants C viewer');

      expect(await accessOf(), "C's access is unchanged").toEqual(before);
      const { page } = await platformMembers(pa, orgId);
      const mine = page.items.find((m) => m.userId === c.userId);
      expect(
        (mine?.assignments ?? []).map((x) => `${x.role.key}:${scopeText(x.scope)}`),
        "C's assignments on the platform list",
      ).toEqual([`member:project:${p1}`]);
    });
  });
});

test.describe('BR-69: platform admin creates an org and invites its owner', () => {
  let pa: APIRequestContext;

  test.beforeAll(async () => {
    pa = await asPlatformAdmin();
  });

  test.afterAll(async () => {
    await pa.dispose().catch(() => null);
  });

  test('TC-69.1: PA creating an org gets 201 with id, name and the slug sent, and the org is listed', async () => {
    const tag = tagOf();
    const slug = `e2e-${tag}`;
    const name = `E2E ${tag}`;
    const res = await pa.post('/api/platform/orgs', { data: { name, slug } });
    const text = await res.text();
    expect(res.status(), `create org: ${text}`).toBe(201);
    const created = CreateOrgResponse.parse(JSON.parse(text));
    expect(created.slug, 'slug is the one sent').toBe(slug);
    expect(created.name, 'name is the one sent').toBe(name);
    expect(created.id.length, 'id').toBeGreaterThan(0);

    const { orgs } = await listAllOrgs(pa);
    const listed = orgs.filter((o) => o.slug === slug);
    expect(
      listed.map((o) => ({ id: o.id, name: o.name })),
      'the org is listed once',
    ).toEqual([{ id: created.id, name }]);
  });

  test('TC-69.2: a new org has the roles owner, admin, member and viewer and no members', async () => {
    const tag = tagOf();
    const org = await createOrg(pa, `E2E ${tag}`, `e2e-${tag}`);
    const { roles } = await platformRoles(pa, org.id);
    expect(roles.map((r) => r.key).sort(), 'the built-in roles').toEqual(['admin', 'member', 'owner', 'viewer']);
    const members = await platformMembers(pa, org.id);
    expect(members.page.items, 'no members').toEqual([]);
    expect(members.page.total, 'member total').toBe(0);
  });

  test('TC-69.3: PA invites the first owner (201); after sign-in they are owner on the org and can create a project', async ({
    browser,
  }) => {
    const tag = tagOf();
    const org = await createOrg(pa, `E2E ${tag}`, `e2e-${tag}`);
    const handle = `e2e-own-${tag}`;
    const email = `${handle}@dev.local`;
    const ownerRoleId = await roleIdOf(pa, org.id, 'owner');

    const invite = await pa.post(`/api/platform/orgs/${org.id}/invitations`, {
      data: { email, roleId: ownerRoleId, scope: { type: 'org' } },
    });
    await expectStatus(invite, 201, 'PA invites the first owner');

    const ctx = await browser.newContext();
    let projectId: string | undefined;
    try {
      const page = await ctx.newPage();
      await page.goto(`/auth/dev-login?handle=${handle}&redirect=/`);
      await acceptViaApi(page, InvitationDto.parse(await invite.json()).id);
      await page.goto(`/auth/dev-login?handle=${handle}&redirect=/`);
      const members = await platformMembers(pa, org.id);
      const member = members.page.items.find((m) => m.email === email);
      expect(member, `${email} is a member of the org after sign-in`).toBeTruthy();
      expect(members.page.total, 'the owner is the only member').toBe(1);

      const access = AccessDto.parse(await ok(await ctx.request.get('/api/me/access'), 200, 'owner access'));
      expect(access.userId, 'the signed-in person').toBe(member?.userId);
      expect(
        access.assignments.map((x) => `${x.roleKey}:${scopeText(x.scope)}`),
        'owner on the org',
      ).toEqual(['owner:org']);

      const connectionId = await installFake({ api: ctx.request });
      const create = await ctx.request.post('/api/projects', {
        data: { connectionId, repoPath: REPO_P1, triggerMode: 'webhook' },
      });
      await expectStatus(create, 201, 'the new owner creates a project');
      const project = ProjectDto.parse(await create.json());
      projectId = project.id;
      const list = pageOf(ProjectDto).parse(
        await ok(await ctx.request.get('/api/projects?pageSize=100'), 200, 'the new owner lists projects'),
      );
      expect(
        list.items.map((p) => p.id),
        'the project is in their list',
      ).toEqual([project.id]);
    } finally {
      if (projectId) await ctx.request.delete(`/api/projects/${projectId}`).catch(() => null);
      await ctx.close().catch(() => null);
    }
  });

  test('TC-69.4: creating an org again with the same slug and another name gets 409 and changes nothing', async () => {
    const tag = tagOf();
    const slug = `e2e-${tag}`;
    const org = await createOrg(pa, `E2E ${tag}`, slug);

    const again = await pa.post('/api/platform/orgs', { data: { name: `Other ${tag}`, slug } });
    await expectStatus(again, 409, 'PA creates the same slug again');

    const listed = (await listAllOrgs(pa)).orgs.filter((o) => o.slug === slug);
    expect(
      listed.map((o) => ({ id: o.id, name: o.name })),
      'still one org with that slug, under its first name',
    ).toEqual([{ id: org.id, name: `E2E ${tag}` }]);
  });

  test('TC-69.5: PA creating "Acme Corp" with an edited slug gets 201 and the slug is the one sent', async () => {
    const slug = `acme-eu-${tagOf()}`;
    const res = await pa.post('/api/platform/orgs', { data: { name: 'Acme Corp', slug } });
    const text = await res.text();
    expect(res.status(), `create org: ${text}`).toBe(201);
    const created = CreateOrgResponse.parse(JSON.parse(text));
    expect(created.slug, 'slug is the one sent, not one derived from the name').toBe(slug);
    expect(created.name, 'name').toBe('Acme Corp');

    const listed = (await listAllOrgs(pa)).orgs.find((o) => o.id === created.id);
    expect(listed?.slug, 'the listed slug').toBe(slug);
  });
});
