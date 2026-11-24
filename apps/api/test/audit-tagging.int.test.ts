import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, invitations, runs, withOrg } from '@agentdesk/db';
import { createTestApp, type TestApp } from './helpers/app';
import {
  acceptInvite,
  changeRole,
  createOrg,
  declineInvite,
  grant,
  inviteAndLogin,
  invite,
  loginAs,
  removeMember,
  revoke,
  roleIdsOf,
  userIdOf,
} from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

// N-AUDITCOL, BR-18: every audit writer tags audit_log.project_ids with the projects the event belongs to.

let t: TestApp;
let orgId: string;
let p1: string;
let p2: string;
let owner: string;
let p1admin: string;
let agentId: string;

beforeAll(async () => {
  t = await createTestApp({
    env: { FAKE_STATE_DIR: freshStateDir(), AGENT_MODELS_SOURCE: 'builtin' },
    wrapAdapters: wideFakeRepos,
  });
  orgId = (await createOrg(t, 'Audit Tag', 'audit-tag')).id;
  owner = await inviteAndLogin(t, orgId, 'at-owner', 'owner', { type: 'org' });
  const conn = await installFake(t, owner);
  p1 = (await makeProject(t, owner, conn)).projectId;
  p2 = (await makeProject(t, owner, conn)).projectId;
  p1admin = await inviteAndLogin(t, orgId, 'at-p1admin', 'admin', { type: 'project', projectIds: [p1] });
  const agent = await send('GET', `/api/projects/${p1}/agent`, p1admin);
  agentId = agent.json<{ id: string }>().id;
}, 180_000);
afterAll(async () => {
  await t.close();
});

const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) =>
  t.app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });

/** The project_ids of every audit row of `action`, read as the app role under withOrg. */
async function tags(action: string, targetId?: string): Promise<string[][]> {
  const rows = await withOrg(t.db, orgId, (tx) =>
    tx
      .select({ projectIds: auditLog.projectIds })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.orgId, orgId),
          eq(auditLog.action, action),
          targetId === undefined ? undefined : eq(auditLog.targetId, targetId),
        ),
      )
      .orderBy(desc(auditLog.at), desc(auditLog.id)),
  );
  // Rows written in one transaction share a timestamp, so compare the sets in a fixed order.
  return rows.map((r) => [...r.projectIds].sort()).sort((a, b) => a.join().localeCompare(b.join()));
}

const both = (): string[] => [p1, p2].sort();

describe('interceptor rows', () => {
  it('tags each project route family with the project the guard resolved', async () => {
    const ok = (res: { statusCode: number }) => expect(res.statusCode).toBeLessThan(300);
    ok(await send('PATCH', `/api/projects/${p1}`, p1admin, { name: 'Renamed P1' }));
    ok(await send('PUT', `/api/projects/${p1}/agent`, p1admin, { model: 'claude-opus-4-1', timeoutSeconds: 3600 }));
    ok(await send('PUT', `/api/agents/${agentId}/credential`, p1admin, { type: 'api_key', value: 'tag-secret' }));
    ok(
      await send('POST', `/api/projects/${p1}/rules`, p1admin, {
        kind: 'prompt',
        command: 'tagged',
        labelFilter: [],
        target: 'issue',
        prompt: 'p',
        enabled: true,
      }),
    );
    ok(
      await send('PUT', `/api/projects/${p1}/skills/tagged`, p1admin, {
        body: '---\ndescription: T\n---\nT.\n',
        message: 'm',
      }),
    );
    ok(await send('PUT', `/api/projects/${p1}/setup-script`, p1admin, { body: 'echo x', baseVersion: null }));
    ok(await send('POST', `/api/projects/${p1}/setup-tests`, p1admin, { script: 'echo x' }));
    const runId = await withOrg(t.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(runs)
        .values({
          orgId,
          projectId: p1,
          command: 'fix',
          skillName: 'fix',
          ticketRef: 'at-1',
          ticketKind: 'issue',
          checkoutRef: 'refs/heads/main',
          triggerSource: 'webhook',
          status: 'running',
          ownerUserId: await userIdOf(t, 'at-owner'),
        })
        .returning({ id: runs.id });
      if (!row) throw new Error('no run');
      return row.id;
    });
    ok(await send('POST', `/api/runs/${runId}/cancel`, p1admin));

    for (const action of [
      'PATCH projects.update',
      'PUT agents.put',
      'PUT agents.putCredential',
      'POST rules.create',
      'PUT skills.put',
      'PUT setupScript.put',
      'POST setupTests.create',
      'POST runs.cancel',
    ]) {
      expect(await tags(action), action).toEqual([[p1]]);
    }
    const cred = await withOrg(t.db, orgId, (tx) =>
      tx
        .select({ payload: auditLog.payload })
        .from(auditLog)
        .where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, 'PUT agents.putCredential'))),
    );
    expect(JSON.stringify(cred)).not.toContain('tag-secret');
    expect(cred[0]?.payload).not.toHaveProperty('value');
  });

  it('leaves an org route untagged', async () => {
    expect((await send('PATCH', `/api/orgs/${orgId}`, owner, { name: 'Audit Tag 2' })).statusCode).toBe(200);
    expect(await tags('PATCH orgs.update')).toEqual([[]]);
  });
});

describe('assignment writers', () => {
  it('tags a project-scope grant and revoke with the project, an org-scope grant with none', async () => {
    await inviteAndLogin(t, orgId, 'at-g1', 'viewer', { type: 'org' });
    const userId = await userIdOf(t, 'at-g1');
    const row = await grant(t, orgId, userId, 'member', { type: 'project', projectId: p1 });
    await revoke(t, orgId, row.id);
    await grant(t, orgId, userId, 'admin', { type: 'org' });
    expect(await tags('assignment.granted', userId)).toEqual([[], [], [p1]]); // invitation grant, org grant, project grant
    expect(await tags('assignment.revoked', userId)).toEqual([[p1]]);
  });
});

describe('invitation writers', () => {
  it('tags created, resent, revoked, accepted (and its grants) and declined with the invitation projects', async () => {
    const created = await invite(t, orgId, 'at-inv1@dev.local', 'member', { type: 'project', projectIds: [p1, p2] });
    expect(await tags('invitation.created', created.id)).toEqual([both()]);
    const tenant = (path: string, method: 'POST' | 'DELETE') =>
      t.app.inject({
        method,
        url: `/api/orgs/${orgId}/invitations/${created.id}${path}`,
        headers: { cookie: owner, 'x-org-id': orgId },
      });
    expect((await tenant('/resend', 'POST')).statusCode).toBe(200);
    expect((await tenant('', 'DELETE')).statusCode).toBe(204);
    expect(await tags('invitation.resent', created.id)).toEqual([both()]);
    expect(await tags('invitation.revoked', created.id)).toEqual([both()]);

    const acc = await invite(t, orgId, 'at-inv2@dev.local', 'member', { type: 'project', projectIds: [p1, p2] });
    const accCookie = await loginAs(t, 'at-inv2');
    expect((await acceptInvite(t, accCookie, acc.id)).statusCode).toBe(200);
    expect(await tags('invitation.accepted', acc.id)).toEqual([both()]);
    expect(await tags('assignment.granted', await userIdOf(t, 'at-inv2'))).toEqual(
      [[p1], [p2]].sort((a, b) => a.join().localeCompare(b.join())),
    );

    const dec = await invite(t, orgId, 'at-inv3@dev.local', 'member', { type: 'project', projectIds: [p1, p2] });
    const decCookie = await loginAs(t, 'at-inv3');
    expect((await declineInvite(t, decCookie, dec.id)).statusCode).toBe(204);
    expect(await tags('invitation.declined', dec.id)).toEqual([both()]);
  });

  it('tags an expired project invitation, and leaves an org-scope one untagged', async () => {
    const stale = await invite(t, orgId, 'at-late@dev.local', 'viewer', { type: 'project', projectIds: [p1, p2] });
    await withOrg(t.db, orgId, (tx) =>
      tx
        .update(invitations)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(invitations.id, stale.id)),
    );
    await invite(t, orgId, 'at-late@dev.local', 'viewer', { type: 'project', projectIds: [p1] });
    expect(await tags('invitation.expired', stale.id)).toEqual([both()]);

    const orgInv = await invite(t, orgId, 'at-orginv@dev.local', 'viewer', { type: 'org' });
    expect(await tags('invitation.created', orgInv.id)).toEqual([[]]);
  });
});

describe('member rows', () => {
  it('leaves role changes and removals untagged', async () => {
    await inviteAndLogin(t, orgId, 'at-m1', 'member', { type: 'org' });
    const userId = await userIdOf(t, 'at-m1');
    const roleIds = await roleIdsOf(t, owner, orgId);
    expect((await changeRole(t, owner, orgId, userId, roleIds.admin)).statusCode).toBe(200);
    expect((await removeMember(t, owner, orgId, userId)).statusCode).toBe(204);
    expect(await tags('member.role_changed', userId)).toEqual([[]]);
    expect(await tags('member.removed', userId)).toEqual([[]]);
  });
});
