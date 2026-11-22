import type {
  AssignmentDto,
  CreateOrgResponse,
  MyInvitationDto,
  Page,
  PlatformAdminDto,
  RoleDto,
} from '@agentdesk/contracts';
import type { TestApp } from './app';

export function cookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list.map((c) => String(c).split(';')[0]).join('; ');
}

/** Dev-logs in `handle` and returns the session cookie header value, or an empty string when the handle is uninvited and not a platform admin (the gate refuses it). Use inviteAndLogin for new users. */
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
 * Platform-invites `${handle}@dev.local` into the org with a built-in role and scope, dev-logs the handle in and
 * accepts the invitation through the invitee route, then signs in again and returns that session cookie (its active
 * org is the oldest membership). Throws unless the
 * invitation answers 201 and the accept answers 200.
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
  const first = await loginAs(t, handle);
  if (first === '') throw new Error(`inviteAndLogin ${handle}: dev-login was refused`);
  const accepted = await acceptInvite(t, first, res.json<{ id: string }>().id);
  if (accepted.statusCode !== 200)
    throw new Error(`inviteAndLogin ${handle} accept answered ${accepted.statusCode}: ${accepted.body}`);
  // A new session starts in the oldest membership, so the returned cookie is pinned like a returning person's.
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

/**
 * Grants a built-in role to a member of the org through the platform route (any role, owner included) and returns
 * the assignment. A repeat of an existing grant answers 200 and returns the same row. Throws unless 200 or 201.
 */
export async function grant(
  t: TestApp,
  orgId: string,
  userId: string,
  roleKey: 'owner' | 'admin' | 'member' | 'viewer',
  scope: { type: 'org' } | { type: 'project'; projectId: string },
): Promise<AssignmentDto> {
  const admin = await asPlatformAdmin(t);
  const rolesRes = await t.app.inject({
    method: 'GET',
    url: `/api/platform/orgs/${orgId}/roles`,
    headers: { cookie: admin },
  });
  const role = rolesRes.json<RoleDto[]>().find((r) => r.key === roleKey);
  if (!role) throw new Error(`grant: org ${orgId} has no role ${roleKey}`);
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${orgId}/assignments`,
    headers: { cookie: admin },
    payload: { userId, roleId: role.id, scope },
  });
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`grant ${roleKey} answered ${res.statusCode}: ${res.body}`);
  }
  return res.json<AssignmentDto>();
}

/** Removes an assignment through the platform route (the last owner too); throws unless it answers 204. */
export async function revoke(t: TestApp, orgId: string, assignmentId: string): Promise<void> {
  const admin = await asPlatformAdmin(t);
  const res = await t.app.inject({
    method: 'DELETE',
    url: `/api/platform/orgs/${orgId}/assignments/${assignmentId}`,
    headers: { cookie: admin },
  });
  if (res.statusCode !== 204) throw new Error(`revoke ${assignmentId} answered ${res.statusCode}: ${res.body}`);
}

/** Platform-invites `email` into the org with a built-in role and scope; throws unless it answers 201. Logs nobody in. */
export async function invite(
  t: TestApp,
  orgId: string,
  email: string,
  roleKey: 'owner' | 'admin' | 'member' | 'viewer',
  scope: { type: 'org' } | { type: 'project'; projectIds: string[] },
): Promise<{ id: string }> {
  const admin = await asPlatformAdmin(t);
  const rolesRes = await t.app.inject({
    method: 'GET',
    url: `/api/platform/orgs/${orgId}/roles`,
    headers: { cookie: admin },
  });
  const role = rolesRes.json<RoleDto[]>().find((r) => r.key === roleKey);
  if (!role) throw new Error(`invite: org ${orgId} has no role ${roleKey}`);
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/platform/orgs/${orgId}/invitations`,
    headers: { cookie: admin },
    payload: { email, roleId: role.id, scope },
  });
  if (res.statusCode !== 201) throw new Error(`invite ${email} answered ${res.statusCode}: ${res.body}`);
  return { id: res.json<{ id: string }>().id };
}

/** `GET /api/me/invitations` as the cookie's user; throws unless it answers 200. */
export async function myInvitations(t: TestApp, cookie: string): Promise<Page<MyInvitationDto>> {
  const res = await t.app.inject({ method: 'GET', url: '/api/me/invitations', headers: { cookie } });
  if (res.statusCode !== 200) throw new Error(`myInvitations answered ${res.statusCode}: ${res.body}`);
  return res.json<Page<MyInvitationDto>>();
}

/** `POST /api/me/invitations/:id/accept` as the cookie's user; returns the raw response. */
export function acceptInvite(t: TestApp, cookie: string, invitationId: string): ReturnType<TestApp['app']['inject']> {
  return t.app.inject({ method: 'POST', url: `/api/me/invitations/${invitationId}/accept`, headers: { cookie } });
}

/** `POST /api/me/invitations/:id/decline` as the cookie's user; returns the raw response. */
export function declineInvite(t: TestApp, cookie: string, invitationId: string): ReturnType<TestApp['app']['inject']> {
  return t.app.inject({ method: 'POST', url: `/api/me/invitations/${invitationId}/decline`, headers: { cookie } });
}

/** Grants the platform admin role to `email` as the session `cookie` and returns the status and the entry (the body of a 200 or 201). */
export async function grantPlatformAdmin(
  t: TestApp,
  cookie: string,
  email: string,
): Promise<{ statusCode: number; entry: PlatformAdminDto }> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/platform/admins',
    headers: { cookie },
    payload: { email },
  });
  return { statusCode: res.statusCode, entry: res.json<PlatformAdminDto>() };
}

/** Revokes platform admin entry `adminId` as the session `cookie`; returns the status code. */
export async function revokePlatformAdmin(t: TestApp, cookie: string, adminId: string): Promise<number> {
  const res = await t.app.inject({ method: 'DELETE', url: `/api/platform/admins/${adminId}`, headers: { cookie } });
  return res.statusCode;
}
