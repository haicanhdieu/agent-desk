import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AcceptInvitationResponse, MyInvitationDto, Page } from '@agentdesk/contracts';
import { connections, projects, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import {
  acceptInvite,
  asPlatformAdmin,
  createOrg,
  declineInvite,
  grant,
  invite,
  inviteAndLogin,
  loginAs,
  myInvitations,
  userIdOf,
} from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let home: string;
const logLines: Record<string, unknown>[] = [];
let n = 0;

beforeAll(async () => {
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        logLines.push(JSON.parse(line) as Record<string, unknown>);
      },
    },
  );
  t = await createTestApp({ logger });
  home = (await createOrg(t, 'Invitee Home', 'invitee-home')).id;
});
afterAll(async () => {
  await t.close();
});

/** One statement as the app role inside the org's RLS scope. */
async function asOrg(orgId: string, text: string, params: unknown[] = []): Promise<{ rows: QueryResultRow[] }> {
  const client = await t.db.pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const res = await client.query(text, params);
    await client.query('commit');
    return res;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function seedProject(orgId: string, name: string): Promise<string> {
  return withOrg(t.db, orgId, async (tx) => {
    const [conn] = await tx
      .insert(connections)
      .values({
        orgId,
        provider: 'fake',
        capabilities: { code: true, board: true },
        externalId: randomUUID(),
        accountName: 'dev',
      })
      .returning({ id: connections.id });
    const [project] = await tx
      .insert(projects)
      .values({
        orgId,
        name,
        repoPath: `dev/${name.toLowerCase()}`,
        codeConnectionId: conn?.id ?? '',
        boardConnectionId: conn?.id ?? '',
      })
      .returning({ id: projects.id });
    return project?.id ?? '';
  });
}

/** A signed-in user (a member of the home org) whose address is `${handle}@dev.local`. */
async function newUser(prefix: string): Promise<{ handle: string; email: string; cookie: string; userId: string }> {
  n += 1;
  const handle = `${prefix}-${n}`;
  const cookie = await inviteAndLogin(t, home, handle, 'viewer', { type: 'org' });
  return { handle, email: `${handle}@dev.local`, cookie, userId: await userIdOf(t, handle) };
}

async function newOrg(label: string, name = label): Promise<string> {
  n += 1;
  return (await createOrg(t, name, `${label.toLowerCase().replace(/[^a-z0-9]/g, '')}-${n}`)).id;
}

async function memberCount(orgId: string, userId: string): Promise<number> {
  const res = await asOrg(orgId, 'select count(*)::int as n from member where organization_id = $1 and user_id = $2', [
    orgId,
    userId,
  ]);
  return Number(res.rows[0]?.n);
}

async function assignedProjects(orgId: string, userId: string): Promise<string[]> {
  const res = await asOrg(
    orgId,
    'select project_id from role_assignments where org_id = $1 and user_id = $2 and project_id is not null order by project_id',
    [orgId, userId],
  );
  return res.rows.map((r) => String(r['project_id']));
}

async function revokeInvitation(orgId: string, id: string): Promise<void> {
  const res = await t.app.inject({
    method: 'DELETE',
    url: `/api/platform/orgs/${orgId}/invitations/${id}`,
    headers: { cookie: await asPlatformAdmin(t) },
  });
  expect(res.statusCode).toBe(204);
}

async function expire(orgId: string, id: string): Promise<void> {
  await asOrg(orgId, "update invitations set expires_at = now() - interval '1 minute' where id = $1", [id]);
}

function getInvitation(cookie: string, id: string) {
  return t.app.inject({ method: 'GET', url: `/api/me/invitations/${id}`, headers: { cookie } });
}

describe('my invitations', () => {
  it('BR-3, BR-41: lists the pending invitations of every org with org, role, scope and inviter; accepting one leaves the rest', async () => {
    const u = await newUser('multi');
    const orgB = await newOrg('Org B');
    const orgC = await newOrg('Org C');
    const pB = await seedProject(orgB, 'PB');
    const invB = await invite(t, orgB, u.email, 'member', { type: 'project', projectIds: [pB] });
    const invC = await invite(t, orgC, u.email, 'admin', { type: 'org' });

    const res = await t.app.inject({ method: 'GET', url: '/api/me/invitations', headers: { cookie: u.cookie } });
    expect(res.statusCode).toBe(200);
    const page = expectContract('me.listInvitations', res) as Page<MyInvitationDto>;
    expect(page.total).toBe(2);
    const byId = new Map(page.items.map((i) => [i.id, i]));
    expect(byId.get(invB.id)).toMatchObject({
      org: { id: orgB, name: 'Org B' },
      role: { key: 'member' },
      scope: { type: 'project', projects: [{ id: pB, name: 'PB' }] },
      status: 'pending',
      invitedBy: { name: expect.any(String), handle: 'admin' },
    });
    expect(byId.get(invC.id)).toMatchObject({ org: { id: orgC }, role: { key: 'admin' }, scope: { type: 'org' } });
    expect(JSON.stringify(page)).not.toMatch(/token|link/i);

    expect((await acceptInvite(t, u.cookie, invB.id)).statusCode).toBe(200);
    const after = await myInvitations(t, u.cookie);
    expect(after.items.map((i) => i.id)).toEqual([invC.id]);
  });

  it('BR-4, BR-48: a revoked row and an expired pending row are not listed and accept answers 409 for each', async () => {
    const u = await newUser('gone');
    const org = await newOrg('Gone Org');
    const revoked = await invite(t, org, u.email, 'viewer', { type: 'org' });
    await revokeInvitation(org, revoked.id);
    const orgE = await newOrg('Gone Expired');
    const expired = await invite(t, orgE, u.email, 'viewer', { type: 'org' });
    await expire(orgE, expired.id);

    expect((await myInvitations(t, u.cookie)).items).toEqual([]);
    const a = await acceptInvite(t, u.cookie, revoked.id);
    expect(a.statusCode).toBe(409);
    expect(a.json()).toMatchObject({ detail: 'Invitation is revoked' });
    const b = await acceptInvite(t, u.cookie, expired.id);
    expect(b.statusCode).toBe(409);
    expect(b.json()).toMatchObject({ detail: 'Invitation is expired' });
    expect(await memberCount(org, u.userId)).toBe(0);
    expect(await memberCount(orgE, u.userId)).toBe(0);
  });

  it('BR-21: accepting a project invitation gives one member row and one assignment per listed project; a deleted project is skipped', async () => {
    const u = await newUser('accept');
    const org = await newOrg('Accept Org', 'Accept Org');
    const p1 = await seedProject(org, 'A1');
    const p2 = await seedProject(org, 'A2');
    const p3 = await seedProject(org, 'A3');
    void p3;
    const gone = await seedProject(org, 'A4');
    const inv = await invite(t, org, u.email, 'member', { type: 'project', projectIds: [p1, p2, gone] });
    await asOrg(org, 'delete from projects where id = $1', [gone]);

    const res = await acceptInvite(t, u.cookie, inv.id);
    expect(res.statusCode).toBe(200);
    const body = expectContract('me.acceptInvitation', res) as AcceptInvitationResponse;
    expect(body).toEqual({ org: { id: org, name: 'Accept Org', slug: expect.any(String) } });
    expect(await memberCount(org, u.userId)).toBe(1);
    expect(await assignedProjects(org, u.userId)).toEqual([p1, p2].sort());
    const got = await getInvitation(u.cookie, inv.id);
    expect(got.json()).toMatchObject({ status: 'accepted' });
  });

  it('BR-22: decline marks the invitation declined, adds no member row, and the inviter sees it under declined', async () => {
    const u = await newUser('decline');
    const org = await newOrg('Decline Org');
    const inv = await invite(t, org, u.email, 'member', { type: 'org' });

    const res = await declineInvite(t, u.cookie, inv.id);
    expect(res.statusCode).toBe(204);
    expect(await memberCount(org, u.userId)).toBe(0);
    expect((await myInvitations(t, u.cookie)).items).toEqual([]);
    const listed = await t.app.inject({
      method: 'GET',
      url: `/api/platform/orgs/${org}/invitations?status=declined`,
      headers: { cookie: await asPlatformAdmin(t) },
    });
    expect((listed.json() as Page<{ id: string; status: string }>).items).toEqual([
      expect.objectContaining({ id: inv.id, status: 'declined' }),
    ]);
  });

  it('BR-23: accept and decline on a revoked, expired, accepted or declined invitation are 409 with the status and change nothing', async () => {
    const u = await newUser('settled');
    const mk = async (label: string) => {
      const org = await newOrg(label);
      return { org, id: (await invite(t, org, u.email, 'viewer', { type: 'org' })).id };
    };
    const revoked = await mk('Settled Revoked');
    await revokeInvitation(revoked.org, revoked.id);
    const expired = await mk('Settled Expired');
    await expire(expired.org, expired.id);
    const accepted = await mk('Settled Accepted');
    expect((await acceptInvite(t, u.cookie, accepted.id)).statusCode).toBe(200);
    const declined = await mk('Settled Declined');
    expect((await declineInvite(t, u.cookie, declined.id)).statusCode).toBe(204);

    const orgs = [revoked.org, expired.org, accepted.org, declined.org];
    const snapshot = async () =>
      Promise.all(
        orgs.map(async (o) => ({
          assignments: (await asOrg(o, 'select id from role_assignments order by id')).rows,
          audit: (await asOrg(o, 'select id from audit_log order by id')).rows,
          members: (await asOrg(o, 'select id from member order by id')).rows,
        })),
      );
    const before = await snapshot();
    const cases: [typeof revoked, string][] = [
      [revoked, 'revoked'],
      [expired, 'expired'],
      [accepted, 'accepted'],
      [declined, 'declined'],
    ];
    for (const [inv, status] of cases) {
      for (const act of [acceptInvite, declineInvite]) {
        const res = await act(t, u.cookie, inv.id);
        expect(res.statusCode, `${status}`).toBe(409);
        expect(res.json()).toMatchObject({ detail: `Invitation is ${status}` });
      }
      const got = await getInvitation(u.cookie, inv.id);
      expect(got.json()).toMatchObject({ status });
    }
    expect(await snapshot()).toEqual(before);
    expect(await memberCount(declined.org, u.userId)).toBe(0);
    expect(await memberCount(revoked.org, u.userId)).toBe(0);
    expect(await memberCount(accepted.org, u.userId)).toBe(1);
  });

  it('BR-25, BR-26: get returns the invitation with its status in any status and a null inviter once the inviter is gone', async () => {
    const u = await newUser('get');
    const org = await newOrg('Get Org');
    const pending = await invite(t, org, u.email, 'viewer', { type: 'org' });
    const res = await getInvitation(u.cookie, pending.id);
    expect(res.statusCode).toBe(200);
    const dto = expectContract('me.getInvitation', res) as MyInvitationDto;
    expect(dto).toMatchObject({ id: pending.id, status: 'pending', invitedBy: { handle: 'admin' } });

    const orgR = await newOrg('Get Revoked');
    const revoked = await invite(t, orgR, u.email, 'viewer', { type: 'org' });
    await revokeInvitation(orgR, revoked.id);
    expect((await getInvitation(u.cookie, revoked.id)).json()).toMatchObject({ status: 'revoked' });
    const orgX = await newOrg('Get Expired');
    const expired = await invite(t, orgX, u.email, 'viewer', { type: 'org' });
    await expire(orgX, expired.id);
    expect((await getInvitation(u.cookie, expired.id)).json()).toMatchObject({ status: 'expired' });

    // the inviter's user row is gone
    const inviter = await newUser('inviter');
    const orgG = await newOrg('Get Gone Inviter');
    const gone = await invite(t, orgG, u.email, 'viewer', { type: 'org' });
    await asOrg(orgG, 'update invitations set invited_by = $1 where id = $2', [inviter.userId, gone.id]);
    await t.db.pool.query('delete from "user" where id = $1', [inviter.userId]);
    expect((await getInvitation(u.cookie, gone.id)).json()).toMatchObject({ invitedBy: null });
  });

  it('BR-42: two accepts at once give one member row, one invitation.accepted audit row, one 200 and one 409', async () => {
    const u = await newUser('race');
    const org = await newOrg('Race Org');
    const inv = await invite(t, org, u.email, 'viewer', { type: 'org' });
    const [a, b] = await Promise.all([acceptInvite(t, u.cookie, inv.id), acceptInvite(t, u.cookie, inv.id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await memberCount(org, u.userId)).toBe(1);
    const audit = await asOrg(org, "select 1 from audit_log where action = 'invitation.accepted' and target_id = $1", [
      inv.id,
    ]);
    expect(audit.rows).toHaveLength(1);
    expect((await getInvitation(u.cookie, inv.id)).json()).toMatchObject({ status: 'accepted' });
  });

  it('BR-45: a person with no org who declines their only invitation keeps an account with no org and the next session has none', async () => {
    const org = await newOrg('Solo Org');
    // the platform admin account can exist without an invitation, so it is the one account here with no membership
    const cookie = await asPlatformAdmin(t);
    const userId = await userIdOf(t, 'admin');
    const memberRows = () => t.db.pool.query('select 1 from member where user_id = $1', [userId]);
    expect((await memberRows()).rowCount).toBe(0);
    const inv = await invite(t, org, 'admin@dev.local', 'viewer', { type: 'org' });
    expect((await myInvitations(t, cookie)).items.map((i) => i.id)).toEqual([inv.id]);

    expect((await declineInvite(t, cookie, inv.id)).statusCode).toBe(204);
    expect((await myInvitations(t, cookie)).items).toEqual([]);
    expect((await memberRows()).rowCount).toBe(0);

    // the next sign-in must not pick the declined invitation up
    expect(await loginAs(t, 'admin')).not.toBe('');
    const rows = await t.db.pool.query<{ active: string | null }>(
      'select active_organization_id as active from session where user_id = $1 order by created_at desc limit 1',
      [userId],
    );
    expect(rows.rows[0]?.active).toBeNull();
    expect(await t.db.pool.query('select 1 from "user" where id = $1', [userId])).toMatchObject({ rowCount: 1 });
  });

  it('N-9, T9: another email’s invitation and a random uuid answer the same 404; an unverified email gets nothing', async () => {
    const u = await newUser('owner-of-none');
    const other = await newUser('someone-else');
    const org = await newOrg('Hidden Org');
    const theirs = await invite(t, org, other.email, 'viewer', { type: 'org' });
    const missing = randomUUID();

    const calls = [
      (id: string) => getInvitation(u.cookie, id),
      (id: string) => acceptInvite(t, u.cookie, id),
      (id: string) => declineInvite(t, u.cookie, id),
    ];
    for (const call of calls) {
      const foreign = await call(theirs.id);
      const none = await call(missing);
      expect(foreign.statusCode).toBe(404);
      expect(none.statusCode).toBe(404);
      const strip = (b: unknown) => {
        const { instance, requestId, ...rest } = b as Record<string, unknown>;
        void [instance, requestId];
        return rest;
      };
      expect(strip(foreign.json())).toEqual(strip(none.json()));
    }
    expect((await getInvitation(other.cookie, theirs.id)).statusCode).toBe(200);

    const unverified = await newUser('unverified');
    const orgU = await newOrg('Unverified Org');
    const inv = await invite(t, orgU, unverified.email, 'viewer', { type: 'org' });
    await t.db.pool.query('update "user" set email_verified = false where id = $1', [unverified.userId]);
    expect((await myInvitations(t, unverified.cookie)).items).toEqual([]);
    expect((await getInvitation(unverified.cookie, inv.id)).statusCode).toBe(404);
    expect((await acceptInvite(t, unverified.cookie, inv.id)).statusCode).toBe(404);
    expect((await declineInvite(t, unverified.cookie, inv.id)).statusCode).toBe(404);
    expect(await memberCount(orgU, unverified.userId)).toBe(0);
    await t.db.pool.query('update "user" set email_verified = true where id = $1', [unverified.userId]);
    expect((await getInvitation(unverified.cookie, inv.id)).json()).toMatchObject({ status: 'pending' });

    const unauthenticated: ['GET' | 'POST', string][] = [
      ['GET', '/api/me/invitations'],
      ['GET', `/api/me/invitations/${theirs.id}`],
      ['POST', `/api/me/invitations/${theirs.id}/accept`],
      ['POST', `/api/me/invitations/${theirs.id}/decline`],
    ];
    for (const [method, url] of unauthenticated) {
      expect((await t.app.inject({ method, url })).statusCode, url).toBe(401);
    }
  });

  it('N-2: accept writes invitation.accepted and assignment.granted, decline writes invitation.declined with the invitee as actor', async () => {
    const u = await newUser('audit');
    const org = await newOrg('Audit Org');
    const p = await seedProject(org, 'AuditP');
    const acc = await invite(t, org, u.email, 'member', { type: 'project', projectIds: [p] });
    await acceptInvite(t, u.cookie, acc.id);
    const org2 = await newOrg('Audit Org Two');
    const dec = await invite(t, org2, u.email, 'viewer', { type: 'org' });
    await declineInvite(t, u.cookie, dec.id);

    const rows = await asOrg(org, 'select action, actor_user_id, target_id from audit_log order by at');
    const actions = rows.rows.map((r) => r['action']);
    expect(actions).toEqual(expect.arrayContaining(['invitation.accepted', 'assignment.granted']));
    const declined = await asOrg(
      org2,
      "select actor_user_id, target_id, payload from audit_log where action = 'invitation.declined'",
    );
    expect(declined.rows).toHaveLength(1);
    expect(declined.rows[0]).toMatchObject({
      actor_user_id: u.userId,
      target_id: dec.id,
      payload: { email: u.email },
    });
  });

  it('N-3: accept and decline log requestId, orgId and invitationId and never an email at info', async () => {
    const u = await newUser('logs');
    const org = await newOrg('Log Org');
    const org2 = await newOrg('Log Org Two');
    const a = await invite(t, org, u.email, 'viewer', { type: 'org' });
    const d = await invite(t, org2, u.email, 'viewer', { type: 'org' });
    logLines.length = 0;
    await acceptInvite(t, u.cookie, a.id);
    await declineInvite(t, u.cookie, d.id);
    const mine = logLines.filter((l) => l['invitationId'] !== undefined);
    expect(mine.map((l) => l['invitationId']).sort()).toEqual([a.id, d.id].sort());
    for (const line of mine) {
      expect(line['requestId']).toEqual(expect.any(String));
      expect(line['orgId']).toEqual(expect.any(String));
    }
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) expect(JSON.stringify(line)).not.toContain(u.email);
  });

  it('accepting while already a member adds the assignments and keeps one member row', async () => {
    const u = await newUser('already');
    const org = await newOrg('Already Org');
    const p1 = await seedProject(org, 'AL1');
    const inv = await invite(t, org, u.email, 'member', { type: 'project', projectIds: [p1] });
    // the person was made a member directly after the invitation was sent
    await t.db.pool.query(
      `insert into member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, 'member', now())`,
      [randomUUID(), org, u.userId],
    );
    await grant(t, org, u.userId, 'viewer', { type: 'org' });
    expect(await memberCount(org, u.userId)).toBe(1);
    const res = await acceptInvite(t, u.cookie, inv.id);
    expect(res.statusCode).toBe(200);
    expect(await memberCount(org, u.userId)).toBe(1);
    expect(await assignedProjects(org, u.userId)).toEqual([p1]);
  });

  it('an invitee whose stored email has upper case lists and accepts the invitation', async () => {
    const u = await newUser('upper');
    const org = await newOrg('Upper Org');
    await t.db.pool.query('update "user" set email = $1 where id = $2', [`Upper-${n}@Dev.Local`, u.userId]);
    const inv = await invite(t, org, `upper-${n}@dev.local`, 'viewer', { type: 'org' });
    expect((await myInvitations(t, u.cookie)).items.map((i) => i.id)).toEqual([inv.id]);
    expect((await getInvitation(u.cookie, inv.id)).statusCode).toBe(200);
    expect((await acceptInvite(t, u.cookie, inv.id)).statusCode).toBe(200);
    expect(await memberCount(org, u.userId)).toBe(1);
  });

  it('returns an org name with markup and SQL metacharacters unchanged', async () => {
    const u = await newUser('markup');
    const name = `<b>Org</b> ';--`;
    const org = await newOrg('markup', name);
    const inv = await invite(t, org, u.email, 'viewer', { type: 'org' });
    expect((await getInvitation(u.cookie, inv.id)).json()).toMatchObject({ org: { name } });
    const res = await acceptInvite(t, u.cookie, inv.id);
    expect((res.json() as AcceptInvitationResponse).org.name).toBe(name);
  });
});
