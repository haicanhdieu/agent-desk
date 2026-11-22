import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { API, allPlatformAdmins, freshUser, grantPlatformAdmin, revokePlatformAdmin } from './helpers';
import { buildCast, disposeCast, type Cast } from './rbac-cast';

/*
 * Local end-to-end for the platform admin role kept in the database, BR-15 (spec "E2E requirements": TC-15.1 to
 * TC-15.11): everyone who is not a platform admin is refused on the list, grant and revoke routes with 403 before any
 * lookup. "admin" is `admin@dev.local` (the cast's `pa`). One cast serves every case (built in `beforeAll`, disposed in
 * `afterAll`): the cases only read or are refused. E is a real entry (a fresh user granted in `beforeAll`, revoked in
 * `afterAll`), T a fresh verified user who is not a platform admin, N a fresh user with no org (invited, signed in, not
 * accepted). Cleanup errors are swallowed so they never mask a failure.
 */

test.describe.configure({ timeout: 300_000 });

let cast: Cast;
let entryId: string;
let entryEmail: string;
let targetEmail: string;
let noOrg: APIRequestContext;
const toDispose: APIRequestContext[] = [];

test.beforeAll(async ({ browser, request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
  cast = await buildCast(browser);
  const e = await freshUser(cast.pa, cast.orgId);
  toDispose.push(e.api);
  entryEmail = e.email;
  entryId = (await grantPlatformAdmin(cast.pa, e.email)).entry.id;
  const t = await freshUser(cast.pa, cast.orgId);
  toDispose.push(t.api);
  targetEmail = t.email;
  const n = await freshUser(cast.pa, cast.orgId);
  noOrg = n.api;
  toDispose.push(n.api);
});

test.afterAll(async () => {
  if (cast && entryId) await revokePlatformAdmin(cast.pa, entryId).catch(() => null);
  for (const ctx of toDispose.splice(0)) await ctx.dispose().catch(() => null);
  if (cast) await disposeCast(cast).catch(() => null);
});

async function expect403(res: APIResponse, what: string): Promise<void> {
  expect(res.status(), `${what}: ${res.status()} ${await res.text()}`).toBe(403);
}

/** The status and the problem fields that name the error, for comparing two refusals. */
async function refusal(res: APIResponse): Promise<{ status: number; type: unknown; title: unknown; detail: unknown }> {
  const body: unknown = JSON.parse(await res.text());
  const problem = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return { status: res.status(), type: problem['type'], title: problem['title'], detail: problem['detail'] };
}

const grantBody = (email: string) => ({ data: { email } });

/** Steps 1 to 3 of TC-15.6 to 15.10: list, grant T and revoke E all answer 403 for `api`. */
async function expectAllRefused(api: APIRequestContext): Promise<void> {
  await expect403(await api.get('/api/platform/admins'), 'list');
  await expect403(await api.post('/api/platform/admins', grantBody(targetEmail)), 'grant');
  await expect403(await api.delete(`/api/platform/admins/${entryId}`), 'revoke');
}

test('TC-15.1: an org owner cannot list platform admins', async () => {
  const res = await cast.o.api.get('/api/platform/admins');
  const text = await res.text();
  expect(res.status(), text).toBe(403);
  expect(text).not.toContain(entryEmail);
  expect(text).not.toContain('admin@dev.local');
  expect(text).not.toContain('"items"');
});

test('TC-15.2: an org owner cannot grant the role, and no entry appears', async () => {
  await expect403(await cast.o.api.post('/api/platform/admins', grantBody(targetEmail)), 'grant as owner');
  const entries = await allPlatformAdmins(cast.pa);
  expect(entries.map((x) => x.email)).not.toContain(targetEmail);
});

test('TC-15.3: an org owner cannot revoke an entry, and it stays listed', async () => {
  await expect403(await cast.o.api.delete(`/api/platform/admins/${entryId}`), 'revoke as owner');
  const entries = await allPlatformAdmins(cast.pa);
  expect(entries.map((x) => x.id)).toContain(entryId);
});

test('TC-15.4: a grant for an unknown email is 403 like a known one, with no hint', async () => {
  const unknown = `e2e-${randomBytes(6).toString('hex')}@dev.local`;
  const res = await cast.o.api.post('/api/platform/admins', grantBody(unknown));
  expect(res.status()).toBe(403);
  const known = await cast.o.api.post('/api/platform/admins', grantBody(targetEmail));
  expect(await refusal(res)).toEqual(await refusal(known));
});

test('TC-15.5: a revoke of an unknown id is 403 like a real one, with no hint', async () => {
  const res = await cast.o.api.delete(`/api/platform/admins/${randomUUID()}`);
  expect(res.status()).toBe(403);
  const real = await cast.o.api.delete(`/api/platform/admins/${entryId}`);
  expect(await refusal(res)).toEqual(await refusal(real));
});

test('TC-15.6: an org admin is refused on list, grant and revoke', async () => {
  await expectAllRefused(cast.d.api);
});

test('TC-15.7: a project admin is refused on list, grant and revoke', async () => {
  await expectAllRefused(cast.a.api);
});

test('TC-15.8: a member is refused on list, grant and revoke', async () => {
  await expectAllRefused(cast.b.api);
});

test('TC-15.9: a viewer is refused on list, grant and revoke', async () => {
  await expectAllRefused(cast.v.api);
});

test('TC-15.10: a user with no org is refused on list, grant and revoke', async () => {
  await expectAllRefused(noOrg);
});

test('TC-15.11: the platform admin gets no tenant data of an org it is not in', async () => {
  const path = `/api/orgs/${cast.orgId}/members`;
  const secrets = [cast.slug, cast.o.handle, cast.d.handle, cast.a.handle, cast.b.handle, cast.v.handle];
  // Without an org header the guard answers 403 or 404; with `x-org-id` naming X the existing org-mismatch check
  // (ADR-0035) answers exactly 409. Neither answer carries data of org X.
  const cases: { headers: Record<string, string>; status: number[]; type?: string }[] = [
    { headers: {}, status: [403, 404] },
    { headers: { 'x-org-id': cast.orgId }, status: [409], type: 'org-mismatch' },
  ];
  for (const { headers, status, type } of cases) {
    const res = await cast.pa.get(path, { headers });
    const text = await res.text();
    const what = `members of org X (${JSON.stringify(headers)}): ${res.status()} ${text}`;
    expect(status, what).toContain(res.status());
    if (type) expect((JSON.parse(text) as { type?: unknown }).type, what).toBe(type);
    for (const secret of secrets) expect(text, what).not.toContain(secret);
  }
});
