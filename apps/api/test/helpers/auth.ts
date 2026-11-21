import type { CreateOrgResponse, RoleDto } from '@agentdesk/contracts';
import type { TestApp } from './app';

export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

/** Dev-logs in `handle` (creating user + personal org) and returns the session cookie header value. */
export async function loginAs(t: TestApp, handle: string): Promise<string> {
  const res = await t.app.inject({ method: 'GET', url: `/auth/dev-login?handle=${encodeURIComponent(handle)}` });
  return cookieOf(res);
}

/** Dev-logs in `admin` (admin@dev.local, a platform admin in the default test env) and returns the session cookie. */
export async function asPlatformAdmin(t: TestApp): Promise<string> {
  return loginAs(t, 'admin');
}

/** Creates an org through the platform route as the platform admin; throws unless it answers 201. */
export async function createOrg(t: TestApp, name: string, slug: string): Promise<CreateOrgResponse> {
  const cookie = await asPlatformAdmin(t);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/platform/orgs',
    headers: { cookie },
    payload: { name, slug },
  });
  if (res.statusCode !== 201) throw new Error(`createOrg ${slug} answered ${res.statusCode}: ${res.body}`);
  return res.json<CreateOrgResponse>();
}

/**
 * Platform-invites `${handle}@dev.local` into the org with a built-in role and scope, then dev-logs the handle in
 * (which accepts the invitation) and returns the session cookie. Throws unless the invitation answers 201.
 */
export async function inviteAndLogin(
  t: TestApp,
  orgId: string,
  handle: string,
  roleKey: 'owner' | 'admin' | 'member' | 'viewer',
  scope: { type: 'org' } | { type: 'project'; projectIds: string[] },
): Promise<string> {
  const admin = await asPlatformAdmin(t);
  const rolesRes = await t.app.inject({
    method: 'GET',
    url: `/api/platform/orgs/${orgId}/roles`,
    headers: { cookie: admin },
  });
  const role = rolesRes.json<RoleDto[]>().find((r) => r.key === roleKey);
  if (!role) throw new Error(`inviteAndLogin: org ${orgId} has no role ${roleKey}`);
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${orgId}/invitations`,
    headers: { cookie: admin },
    payload: { email: `${handle}@dev.local`, roleId: role.id, scope },
  });
  if (res.statusCode !== 201) throw new Error(`inviteAndLogin ${handle} answered ${res.statusCode}: ${res.body}`);
  return loginAs(t, handle);
}

/** The id of the user whose handle is `handle` (the user must exist: log in first). */
export async function userIdOf(t: TestApp, handle: string): Promise<string> {
  const res = await t.db.pool.query<{ id: string }>('select id from "user" where email = $1', [
    `${handle.toLowerCase()}@dev.local`,
  ]);
  const id = res.rows[0]?.id;
  if (id === undefined) throw new Error(`userIdOf: no user for handle ${handle}`);
  return id;
}
