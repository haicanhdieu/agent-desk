import { randomBytes } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
} from '@playwright/test';
import {
  NO_INVITATION_CODE,
  AccessDto,
  InvitationDto,
  PlatformMemberDto,
  ProjectDto,
  pageOf,
  type InvitationScopeRequest,
} from '@agentdesk/contracts';
import { API, acceptViaApi, ok, signInAs } from './helpers';
import {
  REPO_P2,
  buildCast,
  disposeCast,
  disposeSecondOrg,
  installFake,
  roleIdsOf,
  secondOrg,
  type Actor,
  type Cast,
} from './rbac-cast';

/*
 * Local end-to-end for RBAC foundation, invitation-only sign-in and invitation rights (spec "E2E requirements": BR-54,
 * BR-55, BR-56, BR-58, BR-60). PA is the dev-config platform admin; the cast is the spec's: O owner, D admin on the org,
 * A admin on P1, B member on P1 and P2, C member on P1, V viewer on the org. A dev-login handle `h` signs in as the
 * verified email `h@dev.local`, which is the address an invitation names.
 *
 * One cast serves every case of a worker (built in `beforeAll`, disposed in `afterAll`): the cases only add invitations
 * (and the people those invitations let in) to the cast's org or to a second org of their own, and each uses unique
 * emails and asserts on its own invitations (by id or email), so no case depends on another. Users and orgs cannot be
 * deleted, so every handle, email and org slug carries a random tag; every invitation a case made is revoked afterwards,
 * every context it opened is closed, and every cleanup error is swallowed so it never masks a test failure.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

const tagOf = (): string => randomBytes(4).toString('hex');

/** The "not allowed" phrase of a 403 problem (spec Q4: the phrase appears in the problem body). */
const NOT_ALLOWED = 'Not allowed for your role here';

const MemberPage = pageOf(PlatformMemberDto);
const InvitationPage = pageOf(InvitationDto);

async function expectStatus(res: APIResponse, status: number, what: string): Promise<void> {
  expect(res.status(), `${what}: ${res.status()} ${await res.text()}`).toBe(status);
}

/** A 403 that says the action is not allowed. */
async function expect403(res: APIResponse, what: string): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(403);
  expect(text, `${what}: the problem body says not allowed`).toContain(NOT_ALLOWED);
}

// ---- The cast and what a case leaves behind ----

let cast: Cast;
/** The cast to dispose: unset until a build succeeded, and again after its disposal. */
let built: Cast | undefined;
/** The cast's two projects as O sees them (id, name), for the "exactly those projects" checks. */
let p1: ProjectDto;
let p2: ProjectDto;

/** Invitations a case made, to revoke afterwards (a revoke of an accepted or revoked one is refused and swallowed). */
const made: { orgId: string; id: string }[] = [];
/** Contexts a case opened for a person signing in. */
const opened: BrowserContext[] = [];
/** Second orgs a case made. */
const seconds: Awaited<ReturnType<typeof secondOrg>>[] = [];
/** Projects a case added to a second org, deleted by that org's owner. */
const extraProjects: { owner: Actor; id: string }[] = [];

test.beforeAll(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
  const list = pageOf(ProjectDto).parse(
    await ok(await cast.o.api.get('/api/projects?pageSize=100'), 200, 'O lists projects'),
  );
  const first = list.items.find((p) => p.id === cast.p1);
  const second = list.items.find((p) => p.id === cast.p2);
  expect(first && second, 'the cast has P1 and P2').toBeTruthy();
  if (!first || !second) throw new Error('unreachable');
  p1 = first;
  p2 = second;
});

test.afterAll(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

test.afterEach(async () => {
  const pa = built?.pa;
  for (const inv of made.splice(0)) {
    await pa?.delete(`/api/platform/orgs/${inv.orgId}/invitations/${inv.id}`).catch(() => null);
  }
  for (const ctx of opened.splice(0)) await ctx.close().catch(() => null);
  for (const extra of extraProjects.splice(0))
    await extra.owner.api.delete(`/api/projects/${extra.id}`).catch(() => null);
  for (const second of seconds.splice(0)) await disposeSecondOrg(second).catch(() => null);
});

// ---- Invitations ----

const platformInvitationsPath = (orgId: string): string => `/api/platform/orgs/${orgId}/invitations`;
const orgInvitationsPath = (orgId: string): string => `/api/orgs/${orgId}/invitations`;

/** `POST` an invitation on `path`; the response is the caller's to check. Registers a created invitation for cleanup. */
async function postInvitation(
  api: APIRequestContext,
  path: string,
  orgId: string,
  data: { email: string; roleId: string; scope: InvitationScopeRequest },
): Promise<APIResponse> {
  const res = await api.post(path, { data });
  if (res.status() === 201) {
    const created = InvitationDto.safeParse(await res.json());
    if (created.success) made.push({ orgId, id: created.data.id });
  }
  return res;
}

/** Given: an invitation made on `path`, exactly 201 and pending. */
async function invite(
  api: APIRequestContext,
  path: string,
  orgId: string,
  email: string,
  roleId: string,
  scope: InvitationScopeRequest,
): Promise<InvitationDto> {
  const res = await postInvitation(api, path, orgId, { email, roleId, scope });
  const text = await res.text();
  expect(res.status(), `invite ${email}: ${text}`).toBe(201);
  const created = InvitationDto.parse(JSON.parse(text));
  expect(created.status, 'a new invitation is pending').toBe('pending');
  return created;
}

/** Every invitation `path` lists (all pages), 200 only. */
async function listInvitations(api: APIRequestContext, path: string): Promise<InvitationDto[]> {
  const items: InvitationDto[] = [];
  for (let page = 1; ; page++) {
    const body = InvitationPage.parse(
      await ok(await api.get(`${path}?pageSize=100&page=${page}`), 200, 'invitation list'),
    );
    items.push(...body.items);
    if (body.items.length === 0 || items.length >= body.total) return items;
  }
}

/** PA's view of the org's invitations for one address (all statuses). */
async function invitationsFor(orgId: string, email: string): Promise<InvitationDto[]> {
  return (await listInvitations(cast.pa, platformInvitationsPath(orgId))).filter((i) => i.email === email);
}

async function expectNoInvitationFor(orgId: string, email: string, what: string): Promise<void> {
  expect(await invitationsFor(orgId, email), `${what}: no invitation was created for ${email}`).toEqual([]);
}

/** Given: PA invited `email` with a built-in role on the org or on projects of `orgId`. */
const paInvite = (
  orgId: string,
  email: string,
  roleId: string,
  scope: InvitationScopeRequest,
): Promise<InvitationDto> => invite(cast.pa, platformInvitationsPath(orgId), orgId, email, roleId, scope);

/** Given: the invitation revoked by PA, exactly 204. */
async function paRevoke(orgId: string, invitationId: string): Promise<void> {
  await expectStatus(
    await cast.pa.delete(`${platformInvitationsPath(orgId)}/${invitationId}`),
    204,
    'PA revokes the invitation',
  );
}

/** The invitation `id` as PA lists it. */
async function invitationById(orgId: string, id: string): Promise<InvitationDto | undefined> {
  return (await listInvitations(cast.pa, platformInvitationsPath(orgId))).find((i) => i.id === id);
}

const projectScope = (...projectIds: string[]): InvitationScopeRequest => ({ type: 'project', projectIds });

// ---- Sign-in and the platform's member list ----

/** A new person's browser context (own cookie jar, the web origin); closed after the case. */
async function newContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  opened.push(ctx);
  return ctx;
}

function setCookies(res: APIResponse): string[] {
  return res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.name);
}

/** Dev-login as `handle` in `ctx`, which must succeed (the redirect to `/`, a session cookie). */
async function signIn(ctx: BrowserContext, handle: string): Promise<void> {
  const res = await ctx.request.get(`/auth/dev-login?handle=${handle}&redirect=/`, { maxRedirects: 0 });
  await expectStatus(res, 302, `${handle} signs in`);
  expect(setCookies(res).length, `${handle} signed in with a session cookie`).toBeGreaterThan(0);
}

/** Dev-login as `handle` in `ctx`, which must be refused: a redirect to the sign-in page with the no-invitation code, no cookie set, and no session afterwards. */
async function expectSignInRefused(ctx: BrowserContext, handle: string, what: string): Promise<void> {
  const res = await ctx.request.get(`/auth/dev-login?handle=${handle}&redirect=/`, { maxRedirects: 0 });
  expect(res.status(), `${what}: the sign-in is refused with a redirect: ${res.status()} ${await res.text()}`).toBe(
    302,
  );
  expect(res.headers()['location'], `${what}: the redirect names the no-invitation error`).toBe(
    `/sign-in?error=${NO_INVITATION_CODE}`,
  );
  expect(setCookies(res), `${what}: the refusal sets no cookie`).toEqual([]);
  expect(await ctx.cookies(), `${what}: no session cookie in the browser`).toEqual([]);
  await expectStatus(await ctx.request.get('/api/me/access'), 401, `${what}: the context has no session`);
}

/**
 * Dev-login as `handle` in `ctx`, accept the invitation through the invitee route, then sign in again: a new session
 * starts in the oldest membership, so the context's cookie is pinned to the org the person just joined.
 */
async function signInAndAccept(ctx: BrowserContext, handle: string, invitationId: string): Promise<void> {
  const page = await signInAs(ctx, handle);
  await acceptViaApi(page, invitationId);
  await page.close();
  await signIn(ctx, handle);
}

/** Every member PA lists for the org. */
async function platformMembers(orgId: string): Promise<PlatformMemberDto[]> {
  const items: PlatformMemberDto[] = [];
  for (let page = 1; ; page++) {
    const body = MemberPage.parse(
      await ok(
        await cast.pa.get(`/api/platform/orgs/${orgId}/members?pageSize=100&page=${page}`),
        200,
        'platform members',
      ),
    );
    items.push(...body.items);
    if (body.items.length === 0 || items.length >= body.total) return items;
  }
}

/** The member of the org with this address, as PA lists it (undefined when none). */
async function memberByEmail(orgId: string, email: string): Promise<PlatformMemberDto | undefined> {
  return (await platformMembers(orgId)).find((m) => m.email === email);
}

/** The member of the org with this address; the case fails when there is none. */
async function requireMember(orgId: string, email: string): Promise<PlatformMemberDto> {
  const member = await memberByEmail(orgId, email);
  expect(member, `${email} is a member of org ${orgId}`).toBeTruthy();
  if (!member) throw new Error('unreachable');
  return member;
}

/** A member's assignments as `role:org` or `role:project:<id>`, sorted. */
const assignmentTexts = (member: PlatformMemberDto): string[] =>
  member.assignments
    .map((a) => `${a.role.key}:${a.scope.type === 'org' ? 'org' : `project:${a.scope.projectId}`}`)
    .sort();

/** `projects.list` as the signed-in context: id and name of every project it shows, sorted by id. */
async function projectsOf(ctx: BrowserContext): Promise<{ id: string; name: string }[]> {
  const list = pageOf(ProjectDto).parse(
    await ok(await ctx.request.get('/api/projects?pageSize=100'), 200, 'project list'),
  );
  expect(list.total, 'the list total is its length').toBe(list.items.length);
  return list.items.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.id.localeCompare(b.id));
}

const byId = (...projects: ProjectDto[]): { id: string; name: string }[] =>
  projects.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.id.localeCompare(b.id));

/** `GET /api/me/access` of the signed-in context. */
async function accessOf(ctx: BrowserContext): Promise<AccessDto> {
  return AccessDto.parse(await ok(await ctx.request.get('/api/me/access'), 200, 'me access'));
}

const accessTexts = (access: AccessDto): string[] =>
  access.assignments
    .map((a) => `${a.roleKey}:${a.scope.type === 'org' ? 'org' : `project:${a.scope.projectId}`}`)
    .sort();

const emailOfHandle = (handle: string): string => `${handle}@dev.local`;
const emailOf = (who: Actor): string => emailOfHandle(who.handle);

// ---- BR-54 ----

test.describe('BR-54: a person with no account and no pending invitation cannot sign up', () => {
  test('TC-54.1: dev-login of a handle with no account and no invitation is refused and creates no session', async ({
    browser,
  }) => {
    const handle = `e2e-${tagOf()}`;
    await expectNoInvitationFor(cast.orgId, emailOfHandle(handle), 'Given');
    const ctx = await newContext(browser);
    await expectSignInRefused(ctx, handle, 'uninvited handle');
  });

  test('TC-54.2: the refused handle is not in the org member list and a second attempt is refused too', async ({
    browser,
  }) => {
    const handle = `e2e-${tagOf()}`;
    const email = emailOfHandle(handle);
    const before = (await platformMembers(cast.orgId)).map((m) => m.userId).sort();
    const ctx = await newContext(browser);

    await expectSignInRefused(ctx, handle, 'first attempt');
    const members = await platformMembers(cast.orgId);
    expect(
      members.find((m) => m.email === email || m.handle === handle),
      'the member list does not contain the refused handle',
    ).toBeUndefined();
    expect(members.map((m) => m.userId).sort(), 'the member list is unchanged').toEqual(before);

    await expectSignInRefused(ctx, handle, 'second attempt (no account was created)');
    expect(
      (await platformMembers(cast.orgId)).find((m) => m.email === email || m.handle === handle),
      'still not a member after the second attempt',
    ).toBeUndefined();
  });
});

// ---- BR-55 ----

test.describe('BR-55: an invited person signs in with the invited scope', () => {
  test('TC-55.1: a person invited as viewer on the org signs in, sees P1 and P2 and is a viewer on the org of X', async ({
    browser,
  }) => {
    const handle = `e2e-h1-${tagOf()}`;
    const email = emailOfHandle(handle);
    const invitation = await paInvite(cast.orgId, email, cast.roleIds.viewer, { type: 'org' });

    const ctx = await newContext(browser);
    await signInAndAccept(ctx, handle, invitation.id);

    expect(await projectsOf(ctx), 'the list shows P1 and P2 and nothing else').toEqual(byId(p1, p2));
    const access = await accessOf(ctx);
    expect(accessTexts(access), 'access shows viewer on the org scope and nothing else').toEqual(['viewer:org']);
    const member = await requireMember(cast.orgId, email);
    expect(member.userId, 'the member is the signed-in person').toBe(access.userId);
    expect(assignmentTexts(member), 'the member holds viewer on the org').toEqual(['viewer:org']);
  });

  test('TC-55.2: a person invited as member on P1 only signs in and sees P1 only', async ({ browser }) => {
    const handle = `e2e-h2-${tagOf()}`;
    const invitation = await paInvite(cast.orgId, emailOfHandle(handle), cast.roleIds.member, projectScope(cast.p1));

    const ctx = await newContext(browser);
    await signInAndAccept(ctx, handle, invitation.id);

    expect(await projectsOf(ctx), 'the list shows P1 only').toEqual(byId(p1));
  });

  test('TC-55.3: one invitation for P1 and P2 gives member on each, and the list shows both', async ({ browser }) => {
    const handle = `e2e-h3-${tagOf()}`;
    const invitation = await paInvite(
      cast.orgId,
      emailOfHandle(handle),
      cast.roleIds.member,
      projectScope(cast.p1, cast.p2),
    );

    const ctx = await newContext(browser);
    await signInAndAccept(ctx, handle, invitation.id);

    const access = await accessOf(ctx);
    expect(accessTexts(access), 'two assignments: member on P1 and member on P2').toEqual(
      [`member:project:${cast.p1}`, `member:project:${cast.p2}`].sort(),
    );
    expect(await projectsOf(ctx), 'the list shows P1 and P2').toEqual(byId(p1, p2));
  });

  test('TC-55.4: after the invited person signs in and accepts, the platform list shows their invitation as accepted', async ({
    browser,
  }) => {
    const handle = `e2e-h2-${tagOf()}`;
    const email = emailOfHandle(handle);
    const invitation = await paInvite(cast.orgId, email, cast.roleIds.member, projectScope(cast.p1));
    expect((await invitationById(cast.orgId, invitation.id))?.status, 'pending before the sign-in').toBe('pending');

    const ctx = await newContext(browser);
    await signIn(ctx, handle);
    expect((await invitationById(cast.orgId, invitation.id))?.status, 'still pending after the sign-in alone').toBe(
      'pending',
    );
    const page = await signInAs(ctx, handle);
    await acceptViaApi(page, invitation.id);

    const forEmail = await invitationsFor(cast.orgId, email);
    expect(
      forEmail.map((i) => ({ id: i.id, status: i.status })),
      'the one invitation for the address shows status accepted',
    ).toEqual([{ id: invitation.id, status: 'accepted' }]);
  });
});

// ---- BR-56 ----

/** A second org Y (an owner, a project PY and a run), kept for disposal after the case. */
async function makeSecondOrg(browser: Browser): Promise<Awaited<ReturnType<typeof secondOrg>>> {
  const y = await secondOrg(browser, cast.pa);
  seconds.push(y);
  return y;
}

/** B signs in again in a new browser context (B already has an account in X). */
async function signInAgain(browser: Browser, who: Actor, acceptId?: string): Promise<BrowserContext> {
  const ctx = await newContext(browser);
  if (acceptId === undefined) await signIn(ctx, who.handle);
  else await signInAndAccept(ctx, who.handle, acceptId);
  return ctx;
}

test.describe('BR-56: an existing user joins a second org by accepting after sign-in', () => {
  test("TC-56.1: B invited to org Y as viewer on the org signs in again, accepts, and Y's member list shows B as viewer on the org", async ({
    browser,
  }) => {
    const y = await makeSecondOrg(browser);
    const yRoles = await roleIdsOf(cast.pa, y.orgId);
    expect(await memberByEmail(y.orgId, emailOf(cast.b)), 'Given: B is not a member of Y').toBeUndefined();
    const invitation = await paInvite(y.orgId, emailOf(cast.b), yRoles.viewer, { type: 'org' });

    await signInAgain(browser, cast.b);
    expect(await memberByEmail(y.orgId, emailOf(cast.b)), 'B is not a member of Y before accepting').toBeUndefined();
    await signInAgain(browser, cast.b, invitation.id);

    const member = await requireMember(y.orgId, emailOf(cast.b));
    expect(member.userId, 'the member is B').toBe(cast.b.userId);
    expect(assignmentTexts(member), 'B holds viewer on the org of Y').toEqual(['viewer:org']);
  });

  test('TC-56.2: B invited to Y as member on PY1 only has one assignment, member on PY1', async ({ browser }) => {
    const y = await makeSecondOrg(browser);
    const yRoles = await roleIdsOf(cast.pa, y.orgId);
    const connectionId = await installFake(y.owner);
    const created = await y.owner.api.post('/api/projects', {
      data: { connectionId, repoPath: REPO_P2, triggerMode: 'webhook' },
    });
    await expectStatus(created, 201, 'Y owner creates PY2');
    const py2 = ProjectDto.parse(await created.json());
    extraProjects.push({ owner: y.owner, id: py2.id });
    const py1 = y.project;
    expect(py2.id, 'PY2 is another project than PY1').not.toBe(py1);
    const invitation = await paInvite(y.orgId, emailOf(cast.b), yRoles.member, projectScope(py1));

    await signInAgain(browser, cast.b, invitation.id);

    const member = await requireMember(y.orgId, emailOf(cast.b));
    expect(assignmentTexts(member), 'one assignment, member on PY1 (not on PY2)').toEqual([`member:project:${py1}`]);
  });

  test("TC-56.3: after B signs in again and accepts, Y's invitation for B shows status accepted", async ({
    browser,
  }) => {
    const y = await makeSecondOrg(browser);
    const yRoles = await roleIdsOf(cast.pa, y.orgId);
    const invitation = await paInvite(y.orgId, emailOf(cast.b), yRoles.viewer, { type: 'org' });

    await signInAgain(browser, cast.b, invitation.id);

    expect(
      (await invitationsFor(y.orgId, emailOf(cast.b))).map((i) => ({ id: i.id, status: i.status })),
      "B's invitation to Y shows status accepted",
    ).toEqual([{ id: invitation.id, status: 'accepted' }]);
  });
});

// ---- BR-58 ----

test.describe('BR-58: a revoked invitation does nothing', () => {
  test('TC-58.1: after PA revoked the invitation (204), signing in is refused and the member list has no such handle', async ({
    browser,
  }) => {
    const handle = `e2e-h4-${tagOf()}`;
    const email = emailOfHandle(handle);
    const invitation = await paInvite(cast.orgId, email, cast.roleIds.viewer, { type: 'org' });
    await paRevoke(cast.orgId, invitation.id);

    const ctx = await newContext(browser);
    await expectSignInRefused(ctx, handle, 'revoked invitation');

    expect(
      (await platformMembers(cast.orgId)).find((m) => m.email === email || m.handle === handle),
      'no account exists: the member list has no such handle',
    ).toBeUndefined();
    expect((await invitationById(cast.orgId, invitation.id))?.status, 'the invitation stays revoked').toBe('revoked');
  });

  test('TC-58.2: revoking the same invitation again gives 409', async () => {
    const invitation = await paInvite(cast.orgId, emailOfHandle(`e2e-h4-${tagOf()}`), cast.roleIds.viewer, {
      type: 'org',
    });
    await paRevoke(cast.orgId, invitation.id);

    await expectStatus(
      await cast.pa.delete(`${platformInvitationsPath(cast.orgId)}/${invitation.id}`),
      409,
      'PA revokes the revoked invitation again',
    );
    expect((await invitationById(cast.orgId, invitation.id))?.status, 'the invitation stays revoked').toBe('revoked');
  });

  test('TC-58.3: B invited to Y and revoked signs in again and is not a member of Y', async ({ browser }) => {
    const y = await makeSecondOrg(browser);
    const yRoles = await roleIdsOf(cast.pa, y.orgId);
    const membersBefore = (await platformMembers(y.orgId)).map((m) => m.userId).sort();
    const invitation = await paInvite(y.orgId, emailOf(cast.b), yRoles.viewer, { type: 'org' });
    await paRevoke(y.orgId, invitation.id);

    await signInAgain(browser, cast.b);

    const members = await platformMembers(y.orgId);
    expect(
      members.find((m) => m.email === emailOf(cast.b) || m.userId === cast.b.userId),
      'B is not a member of Y',
    ).toBeUndefined();
    expect(members.map((m) => m.userId).sort(), "Y's member list is unchanged").toEqual(membersBefore);
    expect((await invitationById(y.orgId, invitation.id))?.status, 'the invitation stays revoked').toBe('revoked');
  });
});

// ---- BR-60 ----

const newEmail = (): string => `inv-${tagOf()}@example.com`;

/** The project ids an invitation covers (empty for an org-scope one). */
const projectIdsOf = (i: InvitationDto): string[] =>
  i.scope.type === 'project' ? i.scope.projects.map((p) => p.id) : [];

test.describe('BR-60: invitation rights follow grant rights', () => {
  test('TC-60.1: A (admin of P1) inviting a new email as member on P1 gets 201 and a pending invitation', async () => {
    const email = newEmail();
    const res = await postInvitation(cast.a.api, orgInvitationsPath(cast.orgId), cast.orgId, {
      email,
      roleId: cast.roleIds.member,
      scope: projectScope(cast.p1),
    });
    const text = await res.text();
    expect(res.status(), `A invites for P1 as member: ${text}`).toBe(201);
    const created = InvitationDto.parse(JSON.parse(text));
    expect(created.status, 'the invitation is pending').toBe('pending');
    expect(created.email, 'the invited address').toBe(email);
    expect(created.role.key, 'the invited role').toBe('member');
    expect(created.scope.type, 'the invitation is on projects').toBe('project');
    expect(projectIdsOf(created), 'on P1 only').toEqual([cast.p1]);
    expect((await invitationById(cast.orgId, created.id))?.status, 'PA lists it pending').toBe('pending');
  });

  test('TC-60.2: A inviting on the org scope as member gets 403 and no invitation is created', async () => {
    const email = newEmail();
    const res = await postInvitation(cast.a.api, orgInvitationsPath(cast.orgId), cast.orgId, {
      email,
      roleId: cast.roleIds.member,
      scope: { type: 'org' },
    });
    await expect403(res, 'A invites on the org scope');
    await expectNoInvitationFor(cast.orgId, email, 'org-scope invitation by A');
  });

  test('TC-60.3: A inviting for P1 and P2 gets 403 and no invitation is created', async () => {
    const email = newEmail();
    const res = await postInvitation(cast.a.api, orgInvitationsPath(cast.orgId), cast.orgId, {
      email,
      roleId: cast.roleIds.member,
      scope: projectScope(cast.p1, cast.p2),
    });
    await expect403(res, 'A invites for P1 and P2');
    await expectNoInvitationFor(cast.orgId, email, 'P1+P2 invitation by A');
  });

  test('TC-60.4: B (member) inviting for P1 as member gets 403', async () => {
    const email = newEmail();
    const res = await postInvitation(cast.b.api, orgInvitationsPath(cast.orgId), cast.orgId, {
      email,
      roleId: cast.roleIds.member,
      scope: projectScope(cast.p1),
    });
    await expect403(res, 'B invites for P1');
    await expectNoInvitationFor(cast.orgId, email, 'invitation by B');
  });

  test('TC-60.5: V (viewer) inviting for P1 as viewer gets 403', async () => {
    const email = newEmail();
    const res = await postInvitation(cast.v.api, orgInvitationsPath(cast.orgId), cast.orgId, {
      email,
      roleId: cast.roleIds.viewer,
      scope: projectScope(cast.p1),
    });
    await expect403(res, 'V invites for P1');
    await expectNoInvitationFor(cast.orgId, email, 'invitation by V');
  });

  test('TC-60.6: O (owner) inviting a new email as owner on the org gets 201', async () => {
    const email = newEmail();
    const res = await postInvitation(cast.o.api, orgInvitationsPath(cast.orgId), cast.orgId, {
      email,
      roleId: cast.roleIds.owner,
      scope: { type: 'org' },
    });
    const text = await res.text();
    expect(res.status(), `O invites an owner: ${text}`).toBe(201);
    const created = InvitationDto.parse(JSON.parse(text));
    expect(created.status, 'the invitation is pending').toBe('pending');
    expect(created.email, 'the invited address').toBe(email);
    expect(created.role.key, 'the invited role').toBe('owner');
    expect(created.scope, 'on the org').toEqual({ type: 'org' });
  });

  test('TC-60.7: D (admin on the org) inviting a new email as owner gets 403 and no invitation is created', async () => {
    const email = newEmail();
    const res = await postInvitation(cast.d.api, orgInvitationsPath(cast.orgId), cast.orgId, {
      email,
      roleId: cast.roleIds.owner,
      scope: { type: 'org' },
    });
    await expect403(res, 'D invites an owner');
    await expectNoInvitationFor(cast.orgId, email, 'owner invitation by D');
  });

  test('TC-60.8: A lists only the invitations whose every project A administers (the P1 one, not the P2 one)', async () => {
    const forP2 = await invite(
      cast.o.api,
      orgInvitationsPath(cast.orgId),
      cast.orgId,
      newEmail(),
      cast.roleIds.member,
      projectScope(cast.p2),
    );
    const forP1 = await invite(
      cast.o.api,
      orgInvitationsPath(cast.orgId),
      cast.orgId,
      newEmail(),
      cast.roleIds.member,
      projectScope(cast.p1),
    );
    const forBoth = await invite(
      cast.o.api,
      orgInvitationsPath(cast.orgId),
      cast.orgId,
      newEmail(),
      cast.roleIds.viewer,
      projectScope(cast.p1, cast.p2),
    );
    const forOrg = await invite(
      cast.o.api,
      orgInvitationsPath(cast.orgId),
      cast.orgId,
      newEmail(),
      cast.roleIds.viewer,
      { type: 'org' },
    );

    const listed = await listInvitations(cast.a.api, orgInvitationsPath(cast.orgId));
    const ids = listed.map((i) => i.id);
    expect(ids, 'the P1 invitation is listed').toContain(forP1.id);
    for (const hidden of [forP2, forBoth, forOrg]) {
      expect(ids, `the invitation for ${hidden.email} is not listed`).not.toContain(hidden.id);
    }
    for (const inv of listed) {
      expect(inv.scope.type, `invitation ${inv.id} is on projects`).toBe('project');
      expect(
        projectIdsOf(inv).every((id) => id === cast.p1),
        `every project of invitation ${inv.id} is P1`,
      ).toBe(true);
    }
    const allByO = await listInvitations(cast.o.api, orgInvitationsPath(cast.orgId));
    const expected = allByO
      .filter((i) => i.scope.type === 'project' && projectIdsOf(i).every((id) => id === cast.p1))
      .map((i) => i.id)
      .sort();
    expect(ids.slice().sort(), 'exactly the invitations whose projects are all P1').toEqual(expected);
  });

  test('TC-60.9: A revoking an invitation A made for P1 gets 204 and the invitation shows status revoked', async () => {
    const created = await invite(
      cast.a.api,
      orgInvitationsPath(cast.orgId),
      cast.orgId,
      newEmail(),
      cast.roleIds.member,
      projectScope(cast.p1),
    );

    await expectStatus(
      await cast.a.api.delete(`${orgInvitationsPath(cast.orgId)}/${created.id}`),
      204,
      'A revokes their invitation',
    );

    expect((await invitationById(cast.orgId, created.id))?.status, 'PA lists it revoked').toBe('revoked');
    const seenByA = (await listInvitations(cast.a.api, orgInvitationsPath(cast.orgId))).find(
      (i) => i.id === created.id,
    );
    expect(seenByA?.status, 'A lists it revoked').toBe('revoked');
  });

  test('TC-60.10: A revoking an invitation O made for P2 gets 403 and the invitation is still pending', async () => {
    const created = await invite(
      cast.o.api,
      orgInvitationsPath(cast.orgId),
      cast.orgId,
      newEmail(),
      cast.roleIds.member,
      projectScope(cast.p2),
    );

    await expect403(
      await cast.a.api.delete(`${orgInvitationsPath(cast.orgId)}/${created.id}`),
      'A revokes the P2 invitation',
    );

    expect((await invitationById(cast.orgId, created.id))?.status, 'PA lists it pending').toBe('pending');
    const seenByO = (await listInvitations(cast.o.api, orgInvitationsPath(cast.orgId))).find(
      (i) => i.id === created.id,
    );
    expect(seenByO?.status, 'O lists it pending').toBe('pending');
  });

  test('TC-60.11: B (member) listing invitations gets 403', async () => {
    await expect403(await cast.b.api.get(`${orgInvitationsPath(cast.orgId)}?pageSize=100`), 'B lists invitations');
  });

  test('TC-60.12: O lists every pending invitation of X', async () => {
    const seeded = [
      await invite(cast.o.api, orgInvitationsPath(cast.orgId), cast.orgId, newEmail(), cast.roleIds.viewer, {
        type: 'org',
      }),
      await invite(
        cast.o.api,
        orgInvitationsPath(cast.orgId),
        cast.orgId,
        newEmail(),
        cast.roleIds.member,
        projectScope(cast.p1),
      ),
      await invite(
        cast.o.api,
        orgInvitationsPath(cast.orgId),
        cast.orgId,
        newEmail(),
        cast.roleIds.member,
        projectScope(cast.p2),
      ),
    ];

    const listed = await listInvitations(cast.o.api, orgInvitationsPath(cast.orgId));
    const pending = (all: InvitationDto[]): string[] =>
      all
        .filter((i) => i.status === 'pending')
        .map((i) => i.id)
        .sort();
    for (const inv of seeded)
      expect(
        listed.map((i) => i.id),
        `${inv.email} is listed`,
      ).toContain(inv.id);
    expect(pending(listed), "O's pending invitations are exactly the ones X has (PA's view)").toEqual(
      pending(await listInvitations(cast.pa, platformInvitationsPath(cast.orgId))),
    );
  });
});
