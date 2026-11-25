import { expect, test, type APIResponse } from '@playwright/test';
import { API } from './helpers';
import { buildCast, disposeCast, type Cast } from './rbac-cast';

/*
 * `POST /api/connections/:provider/sync` (the call behind Refresh repositories) is connection:create at org level, whatever
 * the provider and whatever the state of the caller's GitHub token (issue 284): a lower role is refused with a 403 before
 * any token is read or any provider is asked. The fake provider stands in for GitHub here; the GitHub token refresh and
 * the 409 "reconnect" / 503 answers are covered against a stubbed GitHub in apps/api/test/connections-token.int.test.ts.
 */

test.describe.configure({ timeout: 300_000 });

test.beforeAll(async ({ request }) => {
  const ready = await request.get(`${API}/readyz`).catch(() => null);
  expect(ready?.ok(), `${API}/readyz is not ready: start the stack with \`pnpm dev\` at the repo root`).toBe(true);
});

let cast: Cast;
let built: Cast | undefined;

test.beforeEach(async ({ browser }) => {
  built = undefined;
  built = await buildCast(browser);
  cast = built;
});

test.afterEach(async () => {
  const done = built;
  built = undefined;
  if (done) await disposeCast(done);
});

async function expectForbidden(res: APIResponse, what: string): Promise<void> {
  const text = await res.text();
  expect(res.status(), `${what}: ${res.status()} ${text}`).toBe(403);
  expect(text, `${what}: names no connection`).not.toContain(cast.connectionId);
}

test('an org owner can sync the org connections', async () => {
  const res = await cast.o.api.post('/api/connections/fake/sync');
  expect(res.status(), await res.text()).toBe(201);
});

test('a viewer, a project member and a project admin are refused with 403', async () => {
  await expectForbidden(await cast.v.api.post('/api/connections/fake/sync'), 'viewer');
  await expectForbidden(await cast.b.api.post('/api/connections/fake/sync'), 'project member');
  await expectForbidden(await cast.a.api.post('/api/connections/fake/sync'), 'project admin');
});
