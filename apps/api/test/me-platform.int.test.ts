import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routes } from '@agentdesk/contracts';
import { createTestApp, type TestApp } from './helpers/app';
import { asPlatformAdmin, createOrg, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let admin: string;

beforeAll(async () => {
  t = await createTestApp();
  admin = await asPlatformAdmin(t);
});
afterAll(async () => {
  await t.close();
});

const get = (cookie?: string, headers: Record<string, string> = {}) =>
  t.app.inject({
    method: 'GET',
    url: routes.me.platform.path,
    headers: { ...(cookie === undefined ? {} : { cookie }), ...headers },
  });

describe('GET /api/me/platform', () => {
  it('answers a platform admin { platformAdmin: true } with exactly that key', async () => {
    const res = await get(admin);
    expect(res.statusCode).toBe(200);
    expectContract('me.platform', res);
    expect(res.json()).toEqual({ platformAdmin: true });
    expect(Object.keys(res.json<object>())).toEqual(['platformAdmin']);
  });

  it('answers a verified non-admin false', async () => {
    const org = await createOrg(t, 'Me Platform Org', 'me-platform-org');
    const viewer = await inviteAndLogin(t, org.id, 'mp-viewer', 'viewer', { type: 'org' });
    const res = await get(viewer);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ platformAdmin: false });
  });

  it('answers false for an unverified user whose email is in platform_admins', async () => {
    const org = await createOrg(t, 'Me Platform Unv Org', 'me-platform-unv-org');
    const cookie = await inviteAndLogin(t, org.id, 'mp-unv', 'viewer', { type: 'org' });
    await t.db.pool.query('insert into platform_admins (email) values ($1)', ['mp-unv@dev.local']);
    await t.db.pool.query('update "user" set email_verified = false where email = $1', ['mp-unv@dev.local']);
    const res = await get(cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ platformAdmin: false });
  });

  it('ignores an x-org-id header', async () => {
    const org = await createOrg(t, 'Me Platform Hdr Org', 'me-platform-hdr-org');
    const res = await get(admin, { 'x-org-id': org.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ platformAdmin: true });
    const bogus = await get(admin, { 'x-org-id': '00000000-0000-4000-8000-000000000000' });
    expect(bogus.statusCode).toBe(200);
  });

  it('is 401 when signed out', async () => {
    expect((await get()).statusCode).toBe(401);
  });
});
