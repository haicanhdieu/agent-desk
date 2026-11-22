import { randomBytes, randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { AccessDto, PlatformAdminDto, pageOf } from '@agentdesk/contracts';
import { z } from 'zod';
import {
  API,
  allPlatformAdmins,
  asPlatformAdmin,
  createOrg,
  freshUser,
  grantPlatformAdmin,
  ok,
  revokePlatformAdmin,
} from './helpers';

/*
 * Local end-to-end for the platform admin role kept in the database (spec "E2E requirements": BR-1, BR-4, BR-5, BR-6,
 * BR-7, BR-9, BR-10, BR-11, BR-13, BR-28). "admin" is `admin@dev.local`, seeded by the local stack start; its own entry
 * is never touched. A fresh user is an `e2e-<rand>` user invited (viewer) into the org this file creates in `beforeAll`
 * and signed in through dev login without accepting, so it has an account and a verified email but no org. Every grant
 * a case makes is revoked in `afterEach` and cleanup errors are swallowed so they never mask a failure.
 */

test.describe.configure({ timeout: 120_000 });

let pa: APIRequestContext;
let orgId: string;
const toDispose: APIRequestContext[] = [];
const toRevoke: string[] = [];

test.beforeAll(async ({ request: probe }) => {
  const ready = await probe.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  pa = await asPlatformAdmin();
  const tag = randomBytes(4).toString('hex');
  orgId = (await createOrg(pa, `E2E PA ${tag}`, `e2e-pa-${tag}`)).id;
});

test.afterEach(async () => {
  for (const id of toRevoke.splice(0)) await pa.delete(`/api/platform/admins/${id}`).catch(() => null);
  for (const ctx of toDispose.splice(0)) await ctx.dispose().catch(() => null);
});

test.afterAll(async () => {
  await pa?.dispose().catch(() => null);
});

const RawPage = z.object({ items: z.array(z.record(z.string(), z.unknown())) });
const ProblemBody = z.object({ errors: z.array(z.object({ pointer: z.string() })).optional() });

/** A fresh user; its context is disposed after the case. */
async function newUser() {
  const user = await freshUser(pa, orgId);
  toDispose.push(user.api);
  return user;
}

/** Grants `email` and registers the entry for the cleanup. */
async function grantFor(email: string) {
  const granted = await grantPlatformAdmin(pa, email);
  toRevoke.push(granted.entry.id);
  return granted;
}

async function accessOf(api: APIRequestContext): Promise<AccessDto> {
  return AccessDto.parse(await ok(await api.get('/api/me/access'), 200, 'access'));
}

async function expectStatus(res: APIResponse, status: number, what: string): Promise<void> {
  expect(res.status(), `${what}: ${res.status()} ${await res.text()}`).toBe(status);
}

async function expectEmailPointer(res: APIResponse, status: number, what: string): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(status);
  const problem = ProblemBody.parse(JSON.parse(text));
  expect(
    problem.errors?.map((e) => e.pointer),
    `${what}: ${text}`,
  ).toContain('/email');
}

const emails = async (): Promise<string[]> => (await allPlatformAdmins(pa)).map((e) => e.email);

// ---- BR-1 ----

test('TC-1.1: the list holds the seeded admin@dev.local entry with its account and no granter', async () => {
  const body: unknown = await ok(await pa.get('/api/platform/admins?pageSize=100'), 200, 'list admins');
  pageOf(PlatformAdminDto).parse(body);
  for (const raw of RawPage.parse(body).items) {
    expect(Object.keys(raw).sort()).toEqual(['email', 'grantedAt', 'grantedBy', 'handle', 'id', 'name', 'userId']);
  }
  const entry = (await allPlatformAdmins(pa)).find((e) => e.email === 'admin@dev.local');
  expect(entry, 'admin@dev.local is not listed: the local stack start seeds it').toBeTruthy();
  expect(entry?.id).toBeTruthy();
  expect(entry?.grantedAt).toBeTruthy();
  expect(entry?.userId).not.toBeNull();
  expect(entry?.name).not.toBeNull();
  expect(entry?.handle).not.toBeNull();
  expect(entry?.grantedBy).toBeNull();
});

test('TC-1.2: a granted fresh user is listed with account fields and the granting admin', async () => {
  const f = await newUser();
  const { status } = await grantFor(f.email);
  expect(status).toBe(201);
  const me = (await allPlatformAdmins(pa)).find((e) => e.email === f.email);
  expect(me, `${f.email} is not listed`).toBeTruthy();
  expect(me?.userId).toBe(f.userId);
  expect(me?.name).not.toBeNull();
  expect(me?.handle).toBe(f.handle);
  expect(me?.grantedAt).toBeTruthy();
  const adminEntry = (await allPlatformAdmins(pa)).find((e) => e.email === 'admin@dev.local');
  expect(me?.grantedBy).toEqual(expect.objectContaining({ name: adminEntry?.name, handle: adminEntry?.handle }));
  expect(me?.grantedBy?.handle).toBe('admin');
});

// ---- BR-4 ----

test('TC-4.1: granting a fresh verified user answers 201 with the new entry', async () => {
  const f = await newUser();
  const res = await pa.post('/api/platform/admins', { data: { email: f.email } });
  const text = await res.text();
  expect(res.status(), text).toBe(201);
  const entry = PlatformAdminDto.parse(JSON.parse(text));
  toRevoke.push(entry.id);
  expect(entry.email).toBe(f.email);
  expect(entry.userId).toBe(f.userId);
  expect(entry.name).not.toBeNull();
  expect(entry.handle).not.toBeNull();
  expect(entry.grantedAt).toBeTruthy();
  expect(entry.grantedBy).not.toBeNull();
});

test('TC-4.2: the entry returned by the grant is in the next list', async () => {
  const f = await newUser();
  const { status, entry } = await grantFor(f.email);
  expect(status).toBe(201);
  const listed = (await allPlatformAdmins(pa)).find((e) => e.email === f.email);
  expect(listed?.id).toBe(entry.id);
});

// ---- BR-5 ----

test('TC-5.1: a granted user answers platformAdmin true on the next request, same session', async () => {
  const f = await newUser();
  expect((await accessOf(f.api)).platformAdmin).toBe(false);
  const { status } = await grantFor(f.email);
  expect(status).toBe(201);
  expect((await accessOf(f.api)).platformAdmin).toBe(true);
});

test('TC-5.2: a granted user reaches platform routes on the next request, same session', async () => {
  const f = await newUser();
  await expectStatus(await f.api.get('/api/platform/orgs'), 403, 'before the grant');
  const { status } = await grantFor(f.email);
  expect(status).toBe(201);
  await expectStatus(await f.api.get('/api/platform/orgs'), 200, 'after the grant');
});

// ---- BR-6 ----

test('TC-6.1: a grant without an email is 400 pointing at the email field', async () => {
  await expectEmailPointer(await pa.post('/api/platform/admins', { data: {} }), 400, 'grant {}');
});

test('TC-6.2: a grant of a non-email is 400 and nothing is granted', async () => {
  await expectEmailPointer(
    await pa.post('/api/platform/admins', { data: { email: 'not-an-email' } }),
    400,
    'grant not-an-email',
  );
  expect(await emails()).not.toContain('not-an-email');
});

test('TC-6.3: an email of 255 characters is 400 and nothing is granted', async () => {
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'b'.repeat(63)}.${'b'.repeat(58)}.com`;
  expect(email.length).toBe(255);
  await expectEmailPointer(await pa.post('/api/platform/admins', { data: { email } }), 400, 'grant 255 chars');
  expect(await emails()).not.toContain(email);
});

test('TC-6.4: an email of exactly 254 characters passes validation and is 404 at /email', async () => {
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'b'.repeat(63)}.${'b'.repeat(57)}.com`;
  expect(email.length).toBe(254);
  await expectEmailPointer(await pa.post('/api/platform/admins', { data: { email } }), 404, 'grant 254 chars');
});

test('TC-6.5: an upper-case email with spaces is trimmed and lowercased', async () => {
  const f = await newUser();
  const res = await pa.post('/api/platform/admins', { data: { email: `  ${f.email.toUpperCase()}  ` } });
  const text = await res.text();
  expect(res.status(), text).toBe(201);
  const entry = PlatformAdminDto.parse(JSON.parse(text));
  toRevoke.push(entry.id);
  expect(entry.email).toBe(f.email);
});

// ---- BR-7 ----

test('TC-7.1: granting an email with no account is 404 at /email and the list does not change', async () => {
  const email = `e2e-${randomBytes(4).toString('hex')}@dev.local`;
  await expectEmailPointer(await pa.post('/api/platform/admins', { data: { email } }), 404, 'grant unknown email');
  expect(await emails()).not.toContain(email);
});

// ---- BR-9 ----

test('TC-9.1: a repeat grant answers 200 with the same entry', async () => {
  const f = await newUser();
  const first = await grantFor(f.email);
  expect(first.status).toBe(201);
  const res = await pa.post('/api/platform/admins', { data: { email: f.email } });
  const text = await res.text();
  expect(res.status(), text).toBe(200);
  expect(PlatformAdminDto.parse(JSON.parse(text)).id).toBe(first.entry.id);
});

test('TC-9.2: after a repeat grant the email is listed exactly once', async () => {
  const f = await newUser();
  await grantFor(f.email);
  await grantFor(f.email);
  expect((await emails()).filter((e) => e === f.email)).toHaveLength(1);
});

// ---- BR-10 ----

test('TC-10.1: revoking another entry answers 204 with no body', async () => {
  const f = await newUser();
  const { entry } = await grantFor(f.email);
  const res = await pa.delete(`/api/platform/admins/${entry.id}`);
  expect(res.status(), await res.text()).toBe(204);
  expect(await res.text()).toBe('');
});

test('TC-10.2: a revoked entry is no longer listed', async () => {
  const f = await newUser();
  const { entry } = await grantFor(f.email);
  await revokePlatformAdmin(pa, entry.id);
  const list = await allPlatformAdmins(pa);
  expect(list.map((e) => e.id)).not.toContain(entry.id);
  expect(list.map((e) => e.email)).not.toContain(f.email);
});

test('TC-10.3: revoking an entry twice is 404 the second time', async () => {
  const f = await newUser();
  const { entry } = await grantFor(f.email);
  await revokePlatformAdmin(pa, entry.id);
  await expectStatus(await pa.delete(`/api/platform/admins/${entry.id}`), 404, 'second revoke');
});

test('TC-10.4: revoking a malformed id is 400', async () => {
  await expectStatus(await pa.delete('/api/platform/admins/not-a-uuid'), 400, 'revoke not-a-uuid');
});

// ---- BR-11 ----

test('TC-11.1: a revoked user answers platformAdmin false on the next request, same session', async () => {
  const f = await newUser();
  const { entry } = await grantFor(f.email);
  expect((await accessOf(f.api)).platformAdmin).toBe(true);
  await revokePlatformAdmin(pa, entry.id);
  expect((await accessOf(f.api)).platformAdmin).toBe(false);
});

test('TC-11.2: a revoked user is refused on every platform route, same session', async () => {
  const f = await newUser();
  const { entry } = await grantFor(f.email);
  await expectStatus(await f.api.get('/api/platform/orgs'), 200, 'before the revoke');
  await revokePlatformAdmin(pa, entry.id);
  await expectStatus(await f.api.get('/api/platform/orgs'), 403, 'platform orgs');
  await expectStatus(await f.api.get('/api/platform/admins'), 403, 'list admins');
  await expectStatus(await f.api.post('/api/platform/admins', { data: { email: f.email } }), 403, 'grant');
});

// ---- BR-13 ----

test('TC-13.1: an admin revokes their own entry while another working admin remains', async () => {
  const f = await newUser();
  await grantFor(f.email);
  const { userId } = await accessOf(f.api);
  const own = (await allPlatformAdmins(f.api)).find((e) => e.userId === userId);
  expect(own, 'F has no entry of its own').toBeTruthy();
  const res = await f.api.delete(`/api/platform/admins/${own?.id}`);
  expect(res.status(), await res.text()).toBe(204);
});

test('TC-13.2: after revoking their own entry the admin is refused on the next request', async () => {
  const f = await newUser();
  await grantFor(f.email);
  const own = (await allPlatformAdmins(f.api)).find((e) => e.userId === f.userId);
  expect(own, 'F has no entry of its own').toBeTruthy();
  await revokePlatformAdmin(f.api, own?.id ?? randomUUID());
  await expectStatus(await f.api.get('/api/platform/admins'), 403, 'list admins');
  expect((await accessOf(f.api)).platformAdmin).toBe(false);
});

// ---- BR-28 ----

test('TC-28.1: dev login as admin on the started stack is a platform admin with no extra step', async () => {
  const ctx = await request.newContext({ baseURL: API });
  toDispose.push(ctx);
  const login = await ctx.get('/auth/dev-login?handle=admin&redirect=/', { maxRedirects: 0 });
  expect(login.status(), await login.text()).toBe(302);
  expect((await accessOf(ctx)).platformAdmin).toBe(true);
});
