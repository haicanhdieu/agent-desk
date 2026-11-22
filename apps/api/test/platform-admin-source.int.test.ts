import { describe, expect, it, vi } from 'vitest';
import { NO_INVITATION_CODE } from '@agentdesk/contracts';
import { seedPlatformAdmin } from '@agentdesk/db';
import { startPg } from '@agentdesk/db/testing';
import { FORBIDDEN_DETAIL } from '../src/access/authorize';
import { isPlatformAdmin } from '../src/access/platform-admin';
import { createTestApp, type TestApp } from './helpers/app';
import { cookieOf, loginAs } from './helpers/auth';

/** Each case gets its own database with no seeded admin, and stops it afterwards. */
async function withApp(
  run: (t: TestApp) => Promise<void>,
  options: { env?: Record<string, string>; seedDevAdmin?: boolean } = {},
): Promise<void> {
  const pg = await startPg();
  try {
    const t = await createTestApp({ pg, seedDevAdmin: options.seedDevAdmin ?? false, env: options.env ?? {} });
    try {
      await run(t);
    } finally {
      await t.close();
    }
  } finally {
    await pg.stop();
  }
}

const accessOf = async (t: TestApp, cookie: string) =>
  (await t.app.inject({ method: 'GET', url: '/api/me/access', headers: { cookie } })).json<{
    platformAdmin: boolean;
  }>().platformAdmin;

const listOrgs = (t: TestApp, cookie: string) =>
  t.app.inject({ method: 'GET', url: '/api/platform/orgs', headers: { cookie } });

describe('platform admins are read from platform_admins', () => {
  it('a seeded email signs in as platform admin, whatever the case of the session email', async () => {
    await withApp(async (t) => {
      await seedPlatformAdmin(t.db, 'src-pa@dev.local');
      const cookie = await loginAs(t, 'src-pa');
      expect(await accessOf(t, cookie)).toBe(true);
      expect((await listOrgs(t, cookie)).statusCode).toBe(200);
      expect(await isPlatformAdmin(t.db, { email: ' SRC-PA@Dev.Local ', emailVerified: true })).toBe(true);
      expect(await isPlatformAdmin(t.db, { email: ' SRC-PA@Dev.Local ', emailVerified: false })).toBe(false);
      expect(await isPlatformAdmin(t.db, { email: 'xsrc-pa@dev.local', emailVerified: true })).toBe(false);
      expect(await isPlatformAdmin(t.db, { email: 'src-pa@dev.local.evil.io', emailVerified: true })).toBe(false);
    });
  });

  it('BR-27: with no matching entry everyone is refused', async () => {
    await withApp(async (t) => {
      await seedPlatformAdmin(t.db, 'src-a@dev.local');
      const a = await loginAs(t, 'src-a');
      const created = await t.app.inject({
        method: 'POST',
        url: '/api/platform/orgs',
        headers: { cookie: a },
        payload: { name: 'Src Org', slug: 'src-org' },
      });
      expect(created.statusCode).toBe(201);
      const orgId = created.json<{ id: string }>().id;
      const roles = await t.app.inject({
        method: 'GET',
        url: `/api/platform/orgs/${orgId}/roles`,
        headers: { cookie: a },
      });
      const viewer = roles.json<{ id: string; key: string }[]>().find((r) => r.key === 'viewer');
      const invited = await t.app.inject({
        method: 'POST',
        url: `/api/platform/orgs/${orgId}/invitations`,
        headers: { cookie: a },
        payload: { email: 'src-b@dev.local', roleId: viewer?.id, scope: { type: 'org' } },
      });
      expect(invited.statusCode).toBe(201);
      const b = await loginAs(t, 'src-b');
      expect(b).not.toBe('');
      expect(await accessOf(t, a)).toBe(true);

      await t.db.pool.query('delete from platform_admins');
      for (const cookie of [a, b]) {
        expect(await accessOf(t, cookie)).toBe(false);
        const res = await listOrgs(t, cookie);
        expect(res.statusCode).toBe(403);
        expect(res.json<{ detail: string }>().detail).toBe(FORBIDDEN_DETAIL);
      }
    });
  });

  it('BR-26: a leftover PLATFORM_ADMIN_EMAILS grants nothing', async () => {
    await withApp(
      async (t) => {
        expect('PLATFORM_ADMIN_EMAILS' in t.config).toBe(false);
        const res = await t.app.inject({ method: 'GET', url: '/auth/dev-login?handle=stale' });
        expect(res.statusCode).toBe(302);
        const location = new URL(String(res.headers['location']), 'http://localhost');
        expect(location.pathname).toBe('/sign-in');
        expect(location.searchParams.get('error')).toBe(NO_INVITATION_CODE);
        expect(cookieOf(res)).toBe('');
        const users = await t.db.pool.query('select 1 from "user" where email = $1', ['stale@dev.local']);
        expect(users.rows).toHaveLength(0);

        const admin = await loginAs(t, 'admin');
        const org = await t.app.inject({
          method: 'POST',
          url: '/api/platform/orgs',
          headers: { cookie: admin },
          payload: { name: 'Stale Org', slug: 'stale-org' },
        });
        const orgId = org.json<{ id: string }>().id;
        const roles = await t.app.inject({
          method: 'GET',
          url: `/api/platform/orgs/${orgId}/roles`,
          headers: { cookie: admin },
        });
        const viewer = roles.json<{ id: string; key: string }[]>().find((r) => r.key === 'viewer');
        const invited = await t.app.inject({
          method: 'POST',
          url: `/api/platform/orgs/${orgId}/invitations`,
          headers: { cookie: admin },
          payload: { email: 'stale@dev.local', roleId: viewer?.id, scope: { type: 'org' } },
        });
        expect(invited.statusCode).toBe(201);
        const stale = await loginAs(t, 'stale');
        expect(stale).not.toBe('');
        expect(await accessOf(t, stale)).toBe(false);
        expect((await listOrgs(t, stale)).statusCode).toBe(403);
      },
      { env: { PLATFORM_ADMIN_EMAILS: 'stale@dev.local' }, seedDevAdmin: true },
    );
  });

  it('a resolver error fails closed', async () => {
    await withApp(
      async (t) => {
        const admin = await loginAs(t, 'admin');
        const before = (await t.db.pool.query('select count(*)::int as n from organization')).rows[0]?.n;
        const real = t.db.pool.query.bind(t.db.pool) as (...args: unknown[]) => Promise<unknown>;
        const spy = vi.spyOn(t.db.pool, 'query').mockImplementation(((...args: unknown[]) => {
          const first = args[0];
          const text = typeof first === 'string' ? first : (first as { text?: string } | undefined)?.text;
          return typeof text === 'string' && text.includes('platform_admins')
            ? Promise.reject(new Error('lookup down'))
            : real(...args);
        }) as never);
        try {
          const res = await t.app.inject({
            method: 'POST',
            url: '/api/platform/orgs',
            headers: { cookie: admin },
            payload: { name: 'Down Org', slug: 'down-org' },
          });
          expect(res.statusCode).toBe(500);
        } finally {
          spy.mockRestore();
        }
        const after = (await t.db.pool.query('select count(*)::int as n from organization')).rows[0]?.n;
        expect(after).toBe(before);
      },
      { seedDevAdmin: true },
    );
  });
});
