import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITATION_EXPIRY_SECONDS, type InvitationDto, type MyInvitationDto } from '@agentdesk/contracts';
import { connections, projects, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import { acceptInvite, asPlatformAdmin, declineInvite, createOrg, invite, inviteAndLogin } from './helpers/auth';
import { expectContract } from './helpers/contract';

let t: TestApp;
let platform: string;
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
  platform = await asPlatformAdmin(t);
  home = (await createOrg(t, 'Resend Home', 'resend-home')).id;
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

function resend(cookie: string, orgId: string, id: string, asPlatform = false) {
  return t.app.inject({
    method: 'POST',
    url: asPlatform
      ? `/api/platform/orgs/${orgId}/invitations/${id}/resend`
      : `/api/orgs/${orgId}/invitations/${id}/resend`,
    headers: { cookie },
  });
}

function revoke(orgId: string, id: string) {
  return t.app.inject({
    method: 'DELETE',
    url: `/api/platform/orgs/${orgId}/invitations/${id}`,
    headers: { cookie: platform },
  });
}

async function newOrg(label: string): Promise<string> {
  n += 1;
  return (await createOrg(t, label, `${label}-${n}`)).id;
}

/** A signed-in user (member of the home org) whose address is `${handle}@dev.local`. */
async function newUser(): Promise<{ handle: string; email: string; cookie: string }> {
  n += 1;
  const handle = `rs-user-${n}`;
  const cookie = await inviteAndLogin(t, home, handle, 'viewer', { type: 'org' });
  return { handle, email: `${handle}@dev.local`, cookie };
}

async function dbRow(orgId: string, id: string): Promise<Record<string, unknown>> {
  const res = await asOrg(orgId, 'select status, expires_at from invitations where id = $1', [id]);
  return res.rows[0] ?? {};
}

async function dbNow(): Promise<number> {
  const res = await t.db.pool.query('select extract(epoch from now()) as s');
  return Number(res.rows[0]?.s) * 1000;
}

describe('invitation resend', () => {
  it('BR-18: resends a pending invitation with a fresh 2-day expiry and the same id', async () => {
    const org = await newOrg('rs-pending');
    const inv = await invite(t, org, 'rs-pending@example.com', 'member', { type: 'org' });
    await asOrg(org, "update invitations set expires_at = now() + interval '1 hour' where id = $1", [inv.id]);
    const res = await resend(platform, org, inv.id, true);
    expect(res.statusCode).toBe(200);
    const dto = expectContract('platform.resendInvitation', res) as InvitationDto;
    expect(dto.id).toBe(inv.id);
    expect(dto.status).toBe('pending');
    const expected = (await dbNow()) + INVITATION_EXPIRY_SECONDS * 1000;
    expect(Math.abs(Date.parse(dto.expiresAt) - expected)).toBeLessThan(60_000);
    const stored = await dbRow(org, inv.id);
    expect(Math.abs(new Date(String(stored.expires_at)).getTime() - expected)).toBeLessThan(60_000);
  });

  it('BR-49: resends a pending row past its expiry and a stored expired row, and the invitee can accept', async () => {
    const org = await newOrg('rs-expired');
    const past = await newUser();
    const stored = await newUser();
    const a = await invite(t, org, past.email, 'member', { type: 'org' });
    const b = await invite(t, org, stored.email, 'member', { type: 'org' });
    await asOrg(org, "update invitations set expires_at = now() - interval '1 minute' where id = $1", [a.id]);
    await asOrg(
      org,
      "update invitations set status = 'expired', expires_at = now() - interval '1 minute' where id = $1",
      [b.id],
    );
    for (const [inv, who] of [
      [a, past],
      [b, stored],
    ] as const) {
      const res = await resend(platform, org, inv.id, true);
      expect(res.statusCode).toBe(200);
      expect(res.json<InvitationDto>().status).toBe('pending');
      const seen = await t.app.inject({
        method: 'GET',
        url: `/api/me/invitations/${inv.id}`,
        headers: { cookie: who.cookie },
      });
      expect(seen.json<MyInvitationDto>().status).toBe('pending');
      expect((await acceptInvite(t, who.cookie, inv.id)).statusCode).toBe(200);
    }
  });

  it('BR-19: refuses to resend an accepted, declined or revoked invitation and leaves the row unchanged', async () => {
    const org = await newOrg('rs-final');
    const acceptor = await newUser();
    const decliner = await newUser();
    const accepted = await invite(t, org, acceptor.email, 'member', { type: 'org' });
    const declined = await invite(t, org, decliner.email, 'member', { type: 'org' });
    const revoked = await invite(t, org, 'rs-revoked@example.com', 'member', { type: 'org' });
    expect((await acceptInvite(t, acceptor.cookie, accepted.id)).statusCode).toBe(200);
    expect((await declineInvite(t, decliner.cookie, declined.id)).statusCode).toBe(204);
    expect((await revoke(org, revoked.id)).statusCode).toBe(204);
    for (const [inv, status] of [
      [accepted, 'accepted'],
      [declined, 'declined'],
      [revoked, 'revoked'],
    ] as const) {
      const before = await dbRow(org, inv.id);
      const res = await resend(platform, org, inv.id, true);
      expect(res.statusCode).toBe(409);
      expect(res.json<{ detail: string }>().detail).toBe('Invitation is no longer pending');
      expect(await dbRow(org, inv.id)).toEqual(before);
      expect(before.status).toBe(status);
    }
  });

  it('BR-19: a resend racing a revoke leaves a state that matches the answers', async () => {
    const org = await newOrg('rs-race');
    const inv = await invite(t, org, 'rs-race@example.com', 'member', { type: 'org' });
    const [r, d] = await Promise.all([resend(platform, org, inv.id, true), revoke(org, inv.id)]);
    // a resend of a pending row is valid before or after the revoke; a resend that lost to the revoke is a 409
    expect([200, 409]).toContain(r.statusCode);
    expect([204, 409]).toContain(d.statusCode);
    if (r.statusCode === 409) expect(d.statusCode).toBe(204);
    const status = (await dbRow(org, inv.id)).status;
    expect(status).toBe(d.statusCode === 204 ? 'revoked' : 'pending');
    // once revoked, a further resend is refused
    if (status === 'revoked') expect((await resend(platform, org, inv.id, true)).statusCode).toBe(409);
  });

  it('BR-50: refuses to resend an expired invitation while a newer pending one exists for the email', async () => {
    const org = await newOrg('rs-dup');
    const old = await invite(t, org, 'rs-dup@example.com', 'member', { type: 'org' });
    await asOrg(
      org,
      "update invitations set status = 'expired', expires_at = now() - interval '1 minute' where id = $1",
      [old.id],
    );
    const fresh = await invite(t, org, 'rs-dup@example.com', 'member', { type: 'org' });
    const beforeOld = await dbRow(org, old.id);
    const beforeFresh = await dbRow(org, fresh.id);
    const res = await resend(platform, org, old.id, true);
    expect(res.statusCode).toBe(409);
    const body = res.json<{ errors?: { pointer: string; detail: string }[] }>();
    expect(body.errors?.[0]?.pointer).toBe('/email');
    expect(body.errors?.[0]?.detail).toBe('This email already has a pending invitation.');
    expect(await dbRow(org, old.id)).toEqual(beforeOld);
    expect(await dbRow(org, fresh.id)).toEqual(beforeFresh);
  });

  it('BR-49: resends an expired invitation although a newer pending one for the email is past its expiry', async () => {
    const org = await newOrg('rs-stale');
    const old = await invite(t, org, 'rs-stale@example.com', 'member', { type: 'org' });
    await asOrg(
      org,
      "update invitations set status = 'expired', expires_at = now() - interval '1 minute' where id = $1",
      [old.id],
    );
    const stale = await invite(t, org, 'rs-stale@example.com', 'member', { type: 'org' });
    // stored pending, effectively expired: nothing live blocks the resend
    await asOrg(org, "update invitations set expires_at = now() - interval '1 minute' where id = $1", [stale.id]);
    const res = await resend(platform, org, old.id, true);
    expect(res.statusCode).toBe(200);
    expect(res.json<InvitationDto>().status).toBe('pending');
    expect((await dbRow(org, old.id)).status).toBe('pending');
    expect((await dbRow(org, stale.id)).status).toBe('expired');
    const audit = await asOrg(org, "select 1 from audit_log where action = 'invitation.expired' and target_id = $1", [
      stale.id,
    ]);
    expect(audit.rows).toHaveLength(1);
  });

  describe('rights', () => {
    let org: string;
    let p1: string;
    let p2: string;
    let owner: string;
    let projectAdmin: string;
    let orgAdmin: string;
    let plainMember: string;
    let viewer: string;

    beforeAll(async () => {
      org = await newOrg('rs-rights');
      p1 = await seedProject(org, 'RS-One');
      p2 = await seedProject(org, 'RS-Two');
      owner = await inviteAndLogin(t, org, 'rs-own', 'owner', { type: 'org' });
      projectAdmin = await inviteAndLogin(t, org, 'rs-padm', 'admin', { type: 'project', projectIds: [p1] });
      plainMember = await inviteAndLogin(t, org, 'rs-mem', 'member', { type: 'org' });
      viewer = await inviteAndLogin(t, org, 'rs-view', 'viewer', { type: 'org' });
      orgAdmin = await inviteAndLogin(t, org, 'rs-oadm', 'admin', { type: 'org' });
    });

    it('refuses a member and a viewer, and a project admin on an invitation they do not administer', async () => {
      const onP2 = await invite(t, org, 'rs-r1@example.com', 'viewer', { type: 'project', projectIds: [p2] });
      const before = await dbRow(org, onP2.id);
      expect((await resend(plainMember, org, onP2.id)).statusCode).toBe(403);
      expect((await resend(viewer, org, onP2.id)).statusCode).toBe(403);
      expect((await resend(projectAdmin, org, onP2.id)).statusCode).toBe(403);
      expect(await dbRow(org, onP2.id)).toEqual(before);
    });

    it('lets an owner and a project admin on their own project resend', async () => {
      const onP1 = await invite(t, org, 'rs-r2@example.com', 'viewer', { type: 'project', projectIds: [p1] });
      const res = await resend(projectAdmin, org, onP1.id);
      expect(res.statusCode).toBe(200);
      expectContract('invitations.resend', res);
      expect((await resend(owner, org, onP1.id)).statusCode).toBe(200);
    });

    it('refuses a project admin on an org-scope invitation and lets an org admin resend it', async () => {
      const onOrg = await invite(t, org, 'rs-r4@example.com', 'member', { type: 'org' });
      const before = await dbRow(org, onOrg.id);
      expect((await resend(projectAdmin, org, onOrg.id)).statusCode).toBe(403);
      expect(await dbRow(org, onOrg.id)).toEqual(before);
      expect((await resend(orgAdmin, org, onOrg.id)).statusCode).toBe(200);
    });

    it('answers 404 for a missing id and for another org invitation', async () => {
      const other = await newOrg('rs-other');
      const theirs = await invite(t, other, 'rs-r3@example.com', 'viewer', { type: 'org' });
      expect((await resend(owner, org, randomUUID())).statusCode).toBe(404);
      expect((await resend(owner, org, theirs.id)).statusCode).toBe(404);
      expect((await resend(platform, org, theirs.id, true)).statusCode).toBe(404);
    });
  });

  it('N-2 and N-3: writes one invitation.resent audit row per resend and logs no email', async () => {
    const org = await newOrg('rs-audit');
    const inv = await invite(t, org, 'rs-audit@example.com', 'member', { type: 'org' });
    const dto = (await resend(platform, org, inv.id, true)).json<InvitationDto>();
    await resend(platform, org, inv.id, true);
    const rows = await asOrg(
      org,
      "select payload from audit_log where action = 'invitation.resent' and target_id = $1",
      [inv.id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.payload).toMatchObject({ actorKind: 'platform_admin' });
    expect(rows.rows[0]?.payload).toMatchObject({ expiresAt: expect.any(String) });
    expect(Date.parse(String((rows.rows[0]?.payload as { expiresAt: string }).expiresAt))).toBe(
      Date.parse(dto.expiresAt),
    );
    const lines = logLines.filter((l) => l.invitationId === inv.id);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) {
      expect(l).toMatchObject({ orgId: org, invitationId: inv.id, requestId: expect.any(String) });
      expect(JSON.stringify(l)).not.toContain('rs-audit@example.com');
    }
  });

  it('audits a member resend as actor kind member', async () => {
    const org = await newOrg('rs-actor');
    const owner = await inviteAndLogin(t, org, 'rs-actor-own', 'owner', { type: 'org' });
    const inv = await invite(t, org, 'rs-actor@example.com', 'member', { type: 'org' });
    expect((await resend(owner, org, inv.id)).statusCode).toBe(200);
    const rows = await asOrg(
      org,
      "select payload from audit_log where action = 'invitation.resent' and target_id = $1",
      [inv.id],
    );
    expect(rows.rows.map((r) => (r.payload as { actorKind: string }).actorKind)).toEqual(['member']);
  });
});
