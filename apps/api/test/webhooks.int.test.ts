import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { and, eq } from 'drizzle-orm';
import { runs, withOrg } from '@agentdesk/db';
import { FAKE_SIGNATURE_HEADER, FakeStore, fakeSignature } from '@agentdesk/core';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin, userIdOf } from './helpers/auth';
import { DEVELOP_REPO, freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let alice: string;
let projectId: string;
let repoPath: string;
let orgId: string;
let externalId: string;
let admin: pg.Pool;
let stateDir: string;
let connectionId: string;

beforeAll(async () => {
  stateDir = freshStateDir();
  t = await createTestApp({ env: { FAKE_STATE_DIR: stateDir }, wrapAdapters: wideFakeRepos });
  const u = new URL(t.pg.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
  orgId = (await createOrg(t, 'Alice', 'alice')).id;
  alice = await inviteAndLogin(t, orgId, 'alice', 'owner', { type: 'org' });
  connectionId = await installFake(t, alice);
  ({ projectId, repoPath } = await makeProject(t, alice, connectionId));
  externalId = `fake-${orgId}`;
  await t.app.inject({
    method: 'PUT',
    url: `/api/projects/${projectId}/skills/fix`,
    headers: { cookie: alice },
    payload: { body: 'x', message: 'm' },
  });
  const rule = await t.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/rules`,
    headers: { cookie: alice },
    payload: { command: 'fix', labelFilter: [], target: 'any', kind: 'skill', skillName: 'fix', enabled: true },
  });
  if (rule.statusCode !== 201) throw new Error(`rule create failed: ${rule.body}`);
  await new FakeStore(stateDir).addTicket({ repoPath, number: 7, kind: 'issue', title: 'Broken', labels: [] });
});
afterAll(async () => {
  await admin.end();
  await t.close();
});

const inboundCount = async (): Promise<number> =>
  Number(((await admin.query('select count(*) as n from inbound_events')).rows[0] as { n: string }).n);

let seq = 0;
function webhook(over: Record<string, unknown> = {}, signWith = t.config.FAKE_WEBHOOK_SECRET) {
  seq += 1;
  const raw = JSON.stringify({
    deliveryId: `wh-${seq}-${Date.now()}`,
    commentId: `wc-${seq}-${Date.now()}`,
    repoPath,
    ticketRef: '7',
    ticketKind: 'issue',
    body: '/fix now',
    author: 'alice',
    authorAssociation: 'OWNER',
    externalId,
    ...over,
  });
  return {
    raw,
    send: (headers: Record<string, string> = {}) =>
      t.app.inject({
        method: 'POST',
        url: '/webhooks/fake',
        headers: {
          'content-type': 'application/json',
          [FAKE_SIGNATURE_HEADER]: fakeSignature(raw, signWith),
          ...headers,
        },
        payload: raw,
      }),
  };
}

describe('POST /webhooks/:provider', () => {
  it('bad signature is 401 problem+json and writes no row', async () => {
    const before = await inboundCount();
    const res = await webhook({}, 'wrong-secret').send();
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const missing = await webhook().send({ [FAKE_SIGNATURE_HEADER]: '' });
    expect(missing.statusCode).toBe(401);
    expect(await inboundCount()).toBe(before);
  });

  it('a signature over different bytes is rejected (raw body is what is verified)', async () => {
    const w = webhook();
    const res = await t.app.inject({
      method: 'POST',
      url: '/webhooks/fake',
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: fakeSignature(w.raw, 'dev') },
      payload: w.raw.replace('/fix now', '/fix  now'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid delivery is 202, starts run-<id> and records workflow_id; replay is 200 duplicate', async () => {
    t.temporal.reset();
    const w = webhook();
    const res = await w.send();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ outcome: 'run_created' });
    const rows = await withOrg(t.db, orgId, (tx) => tx.select().from(runs).where(eq(runs.projectId, projectId)));
    const run = rows.find((r) => r.ticketRef === '7');
    expect(run).toMatchObject({
      status: 'queued',
      command: 'fix',
      ticketTitle: 'Broken',
      workflowId: `run-${run?.id}`,
    });
    const starts = t.temporal.callsOfKind('start');
    expect(starts).toHaveLength(1);
    expect(starts[0]?.workflowId).toBe(`run-${run?.id}`);
    expect(starts[0]?.args[0]).toBe('RunWorkflow');
    expect(starts[0]?.args[1]).toMatchObject({ taskQueue: 'agentdesk', args: [{ orgId, runId: run?.id }] });

    expect(run?.ownerUserId).toBe(await userIdOf(t, 'alice'));

    const again = await w.send();
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ outcome: 'duplicate' });
    expect(t.temporal.callsOfKind('start')).toHaveLength(1);
  });

  it('a commenter who is not linked to a user is 200 ignored_owner_unlinked and starts nothing', async () => {
    t.temporal.reset();
    const res = await webhook({ author: 'nobody-linked', ticketRef: '31' }).send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: 'ignored_owner_unlinked' });
    const rows = await withOrg(t.db, orgId, (tx) => tx.select().from(runs).where(eq(runs.ticketRef, '31')));
    expect(rows).toHaveLength(0);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
  });

  it('a linked viewer is 200 ignored_owner_not_permitted and starts nothing', async () => {
    t.temporal.reset();
    await inviteAndLogin(t, orgId, 'vera', 'viewer', { type: 'org' });
    const res = await webhook({ author: 'vera', authorAssociation: 'MEMBER', ticketRef: '32' }).send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: 'ignored_owner_not_permitted' });
    const rows = await withOrg(t.db, orgId, (tx) => tx.select().from(runs).where(eq(runs.ticketRef, '32')));
    expect(rows).toHaveLength(0);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
  });

  it("an issue run checks out the repository's default branch recorded at project creation", async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: alice },
      payload: { connectionId, repoPath: DEVELOP_REPO, triggerMode: 'webhook' },
    });
    expect(created.statusCode).toBe(201);
    const devProjectId = (created.json() as { id: string }).id;
    await t.app.inject({
      method: 'PUT',
      url: `/api/projects/${devProjectId}/skills/fix`,
      headers: { cookie: alice },
      payload: { body: 'x', message: 'm' },
    });
    const rule = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${devProjectId}/rules`,
      headers: { cookie: alice },
      payload: { command: 'fix', labelFilter: [], target: 'any', kind: 'skill', skillName: 'fix', enabled: true },
    });
    expect(rule.statusCode).toBe(201);
    await new FakeStore(stateDir).addTicket({
      repoPath: DEVELOP_REPO,
      number: 3,
      kind: 'issue',
      title: 'T',
      labels: [],
    });
    const res = await webhook({ repoPath: DEVELOP_REPO, ticketRef: '3' }).send();
    expect(res.statusCode).toBe(202);
    const [row] = await withOrg(t.db, orgId, (tx) => tx.select().from(runs).where(eq(runs.projectId, devProjectId)));
    expect(row?.checkoutRef).toBe('develop');
  });

  it('Temporal down: still 202, run stays queued without workflow_id', async () => {
    t.temporal.reset();
    t.temporal.failing = true;
    const res = await webhook({ ticketRef: '8', ticketKind: 'issue' }).send();
    t.temporal.failing = false;
    expect(res.statusCode).toBe(202);
    const rows = await withOrg(t.db, orgId, (tx) => tx.select().from(runs).where(eq(runs.ticketRef, '8')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'queued', workflowId: null });
  });

  it('ignored and unknown deliveries are 200', async () => {
    const ignored = await webhook({ body: 'no command here', ticketRef: '9' }).send();
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json()).toEqual({ outcome: 'ignored_no_command' });
    const unknown = await webhook({ externalId: 'fake-nobody' }).send();
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json()).toEqual({ outcome: 'ignored_unknown_project' });
    const notAnEvent = await webhook({ deliveryId: '' }).send();
    expect(notAnEvent.statusCode).toBe(200);
    expect(notAnEvent.json()).toEqual({ outcome: 'ignored' });
  });

  it('unknown or unregistered provider is 404; the route is public', async () => {
    const github = await t.app.inject({ method: 'POST', url: '/webhooks/github', payload: {} });
    expect(github.statusCode).toBe(404);
    const nonsense = await t.app.inject({ method: 'POST', url: '/webhooks/nope', payload: {} });
    expect(nonsense.statusCode).toBe(404);
  });

  it('oversized bodies are rejected with 413 before verification', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/webhooks/fake',
      headers: { 'content-type': 'application/json', [FAKE_SIGNATURE_HEADER]: 'a'.repeat(64) },
      payload: JSON.stringify({ pad: 'x'.repeat(1_100_000) }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('a declared Content-Length over the limit is rejected up front', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/webhooks/fake',
      headers: {
        'content-type': 'application/json',
        'content-length': '2000000',
        [FAKE_SIGNATURE_HEADER]: 'a'.repeat(64),
      },
      payload: '{}',
    });
    expect(res.statusCode).toBe(413);
  });

  it('a routing error is a 200 with outcome error (no provider retry storm)', async () => {
    const rule = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/rules`,
      headers: { cookie: alice },
      payload: { command: 'lbl', labelFilter: ['bug'], target: 'any', kind: 'skill', skillName: 'fix', enabled: true },
    });
    expect(rule.statusCode).toBe(201);
    // ticket 4040 does not exist on the fake board, so fetching its labels fails
    const res = await webhook({ body: '/lbl', ticketRef: '4040' }).send();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ outcome: 'error' });
  });

  it('JSON parsing elsewhere is unaffected', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/projects/' + projectId + '/rules',
      headers: { cookie: alice },
      payload: { command: 'other', labelFilter: [], target: 'any', kind: 'skill', skillName: 'fix', enabled: true },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('dev fake routes', () => {
  const post = (url: string, payload: object, cookie: string | null = alice) =>
    t.app.inject({ method: 'POST', url, headers: cookie === null ? {} : { cookie }, payload });

  it('require a session', async () => {
    expect((await post('/dev/fake/tickets', {}, null)).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: `/dev/fake/posted?repoPath=${repoPath}` })).statusCode).toBe(401);
  });

  it('create a ticket, then a webhook-delivered comment starts a run; poll delivery only stores the comment', async () => {
    t.temporal.reset();
    const tk = await post('/dev/fake/tickets', {
      repoPath,
      number: 21,
      kind: 'issue',
      title: 'Dev ticket',
      labels: ['bug', { name: 'p1', color: 'ff0000' }],
    });
    expect(tk.statusCode).toBe(201);
    const c = await post('/dev/fake/comments', {
      repoPath,
      ticketNumber: 21,
      body: '/fix please',
      author: 'alice',
      deliver: 'webhook',
      projectId,
    });
    expect(c.statusCode).toBe(201);
    const body = c.json() as { outcome: string; runId: string; commentId: string };
    expect(body.outcome).toBe('run_created');
    const [row] = await withOrg(t.db, orgId, (tx) => tx.select().from(runs).where(eq(runs.id, body.runId)));
    expect(row).toMatchObject({
      ticketTitle: 'Dev ticket',
      ownerUserId: await userIdOf(t, 'alice'),
      ticketLabels: [
        { name: 'bug', color: '888888' },
        { name: 'p1', color: 'ff0000' },
      ],
      triggerCommentId: body.commentId,
    });
    expect(t.temporal.callsOfKind('start')).toHaveLength(1);

    const polled = await post('/dev/fake/comments', {
      repoPath,
      ticketNumber: 21,
      body: '/fix again',
      deliver: 'poll',
    });
    expect(polled.json()).toMatchObject({ outcome: 'queued_for_poll' });
    expect(t.temporal.callsOfKind('start')).toHaveLength(1);
  });

  it('POST /dev/fake/tickets accepts linked on PRs and issues', async () => {
    const pr = await post('/dev/fake/tickets', { repoPath, number: 31, kind: 'pr', title: 'PR', linked: [30] });
    const issue = await post('/dev/fake/tickets', {
      repoPath,
      number: 30,
      kind: 'issue',
      title: 'Issue',
      linked: [31],
    });
    expect(pr.statusCode).toBe(201);
    expect(issue.statusCode).toBe(201);
    const store = new FakeStore(stateDir);
    expect((await store.getTicket(repoPath, 31))?.linked).toEqual([30]);
    expect((await store.getTicket(repoPath, 30))?.linked).toEqual([31]);
  });

  it('rejects linked with 0, -1, 1.5, a string, a number above 1e9 or 11 numbers', async () => {
    const bad: unknown[] = [[0], [-1], [1.5], ['3'], [1_000_000_001], Array.from({ length: 11 }, (_, i) => i + 1)];
    for (const linked of bad) {
      const res = await post('/dev/fake/tickets', { repoPath, number: 32, kind: 'pr', title: 'PR', linked });
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const { errors } = res.json<{ errors: { pointer: string }[] }>();
      expect(errors.some((e) => e.pointer.startsWith('/linked'))).toBe(true);
    }
  });

  it('lists the bot comments of a repo', async () => {
    await new FakeStore(stateDir).postBotComment(repoPath, '21', 'Run finished');
    await new FakeStore(stateDir).postBotComment('other/repo', '1', 'not mine');
    const res = await t.app.inject({
      method: 'GET',
      url: `/dev/fake/posted?repoPath=${repoPath}`,
      headers: { cookie: alice },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { body: string }[]).map((c) => c.body)).toEqual(['Run finished']);
  });

  it('validates untrusted input strictly', async () => {
    for (const bad of ['../etc', 'a/b/c', 'a/..', 'a b/c', '']) {
      const res = await post('/dev/fake/tickets', { repoPath: bad, number: 1, kind: 'issue', title: 't' });
      expect(res.statusCode, bad).toBe(400);
    }
    const res = await post('/dev/fake/comments', { repoPath, ticketNumber: 0, body: 'x', deliver: 'webhook' });
    expect(res.statusCode).toBe(400);
    const badPosted = await t.app.inject({
      method: 'GET',
      url: '/dev/fake/posted?repoPath=../x',
      headers: { cookie: alice },
    });
    expect(badPosted.statusCode).toBe(400);
  });

  it('webhook delivery for a repo with no project in the session org is 404', async () => {
    const res = await post('/dev/fake/comments', {
      repoPath: 'nobody/home',
      ticketNumber: 1,
      body: '/fix',
      deliver: 'webhook',
    });
    expect(res.statusCode).toBe(404);
  });

  it('is absent (404) when the fake provider is disabled', async () => {
    const off = await createTestApp({ env: { ENABLE_FAKE_PROVIDER: 'false' } });
    try {
      const offOrg = await createOrg(off, 'Carol', 'carol');
      const cookie = await inviteAndLogin(off, offOrg.id, 'carol', 'owner', { type: 'org' });
      const res = await off.app.inject({
        method: 'POST',
        url: '/dev/fake/tickets',
        headers: { cookie },
        payload: { repoPath: 'a/b', number: 1, kind: 'issue', title: 't' },
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });
});

describe('run owner by webhook', () => {
  interface OwnerCtx {
    orgId: string;
    externalId: string;
    p1: { id: string; repoPath: string };
    p2: { id: string; repoPath: string };
    o: string;
    b: string;
    ids: { b: string; v: string; a: string };
    p1Assignment: string;
  }
  let c: OwnerCtx;
  let ticketSeq = 100;
  const bot = (): string => t.config.BOT_NAME;

  async function projectWithRules(cookie: string, connection: string): Promise<{ id: string; repoPath: string }> {
    const p = await makeProject(t, cookie, connection);
    // Two commands on two skills: a live run of one must not block the other (the active-run guard is per skill).
    for (const command of ['fix', 'second']) {
      await t.app.inject({
        method: 'PUT',
        url: `/api/projects/${p.projectId}/skills/${command}`,
        headers: { cookie },
        payload: { body: 'x', message: 'm' },
      });
      const rule = await t.app.inject({
        method: 'POST',
        url: `/api/projects/${p.projectId}/rules`,
        headers: { cookie },
        payload: { command, labelFilter: [], target: 'any', kind: 'skill', skillName: command, enabled: true },
      });
      if (rule.statusCode !== 201) throw new Error(`rule create failed: ${rule.body}`);
    }
    return { id: p.projectId, repoPath: p.repoPath };
  }

  beforeAll(async () => {
    const org = await createOrg(t, 'Owners', 'owners');
    const o = await inviteAndLogin(t, org.id, 'own-o', 'owner', { type: 'org' });
    const connection = await installFake(t, o);
    const p1 = await projectWithRules(o, connection);
    const p2 = await projectWithRules(o, connection);
    const b = await inviteAndLogin(t, org.id, 'own-b', 'member', { type: 'project', projectIds: [p1.id, p2.id] });
    await inviteAndLogin(t, org.id, 'own-v', 'viewer', { type: 'project', projectIds: [p1.id] });
    await inviteAndLogin(t, org.id, 'own-a', 'admin', { type: 'project', projectIds: [p1.id] });
    const ids = { b: await userIdOf(t, 'own-b'), v: await userIdOf(t, 'own-v'), a: await userIdOf(t, 'own-a') };
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/orgs/${org.id}/assignments?projectId=${p1.id}`,
      headers: { cookie: o },
    });
    const mine = (list.json() as { items: { id: string; userId: string; role: { key: string } }[] }).items.find(
      (a) => a.userId === ids.b,
    );
    if (!mine) throw new Error('own-b has no assignment on P1');
    c = { orgId: org.id, externalId: `fake-${org.id}`, p1, p2, o, b, ids, p1Assignment: mine.id };
  });

  /** A fresh ticket on the project's repo; every scenario uses its own so rules and counts never interfere. */
  async function newTicket(p: { repoPath: string }): Promise<string> {
    ticketSeq += 1;
    await new FakeStore(stateDir).addTicket({
      repoPath: p.repoPath,
      number: ticketSeq,
      kind: 'issue',
      title: `T${ticketSeq}`,
      labels: [],
    });
    return String(ticketSeq);
  }

  const comment = (p: { repoPath: string }, ticketRef: string, over: Record<string, unknown>) =>
    webhook({ repoPath: p.repoPath, ticketRef, externalId: c.externalId, authorAssociation: 'MEMBER', ...over }).send();

  const ignoredFor = async (
    p: { id: string },
    ticketRef: string,
  ): Promise<{ outcome: string; detail: string | null }[]> => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${p.id}/ignored`,
      headers: { cookie: c.o },
    });
    return (res.json() as { items: { ticketRef: string; outcome: string; detail: string | null }[] }).items.filter(
      (i) => i.ticketRef === ticketRef,
    );
  };

  const runsOn = (p: { id: string }, ticketRef: string) =>
    withOrg(t.db, c.orgId, (tx) =>
      tx
        .select()
        .from(runs)
        .where(and(eq(runs.projectId, p.id), eq(runs.ticketRef, ticketRef))),
    );

  /** Marks a run as live right now: started an hour ago, not finished. */
  const makeLive = (runId: string) =>
    admin.query(`update runs set status = 'running', started_at = now() - interval '1 hour' where id = $1`, [runId]);

  /** Ends every live run so the next scenario's bot comment has no stale origin candidates. */
  const endAllRuns = () =>
    admin.query(
      `update runs set status = 'succeeded', finished_at = now() - interval '30 minutes' where status = 'running' and org_id = $1`,
      [c.orgId],
    );

  const runDto = async (runId: string, cookie: string) =>
    (await t.app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: { cookie } })).json() as {
      ownerUserId: string | null;
    };

  it('BR-26: an association outside owner, member and collaborator starts nothing', async () => {
    t.temporal.reset();
    const ref = await newTicket(c.p1);
    const res = await comment(c.p1, ref, { author: 'own-b', authorAssociation: 'NONE', body: '/fix' });
    expect(res.json()).toEqual({ outcome: 'ignored_unauthorized' });
    expect(await runsOn(c.p1, ref)).toHaveLength(0);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
  });

  it('BR-50: a linked member with run:create starts a run that shows them as owner', async () => {
    t.temporal.reset();
    const ref = await newTicket(c.p1);
    const res = await comment(c.p1, ref, { author: 'own-b', body: '/fix' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ outcome: 'run_created' });
    const [row] = await runsOn(c.p1, ref);
    expect(row?.ownerUserId).toBe(c.ids.b);
    expect(await runDto(row?.id ?? '', c.b)).toMatchObject({ ownerUserId: c.ids.b });
    expect(t.temporal.callsOfKind('start')).toHaveLength(1);
  });

  it('BR-51: a viewer on P1 and an admin scoped only to P1 commenting on P2 are ignored as not permitted', async () => {
    t.temporal.reset();
    const refViewer = await newTicket(c.p1);
    const viewer = await comment(c.p1, refViewer, { author: 'own-v', body: '/fix' });
    expect(viewer.json()).toEqual({ outcome: 'ignored_owner_not_permitted' });
    expect(await runsOn(c.p1, refViewer)).toHaveLength(0);
    expect(await ignoredFor(c.p1, refViewer)).toMatchObject([{ outcome: 'ignored_owner_not_permitted' }]);

    const refAdmin = await newTicket(c.p2);
    const outOfScope = await comment(c.p2, refAdmin, { author: 'own-a', body: '/fix' });
    expect(outOfScope.json()).toEqual({ outcome: 'ignored_owner_not_permitted' });
    expect(await runsOn(c.p2, refAdmin)).toHaveLength(0);
    expect(await ignoredFor(c.p2, refAdmin)).toMatchObject([{ outcome: 'ignored_owner_not_permitted' }]);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
  });

  it('BR-52: a commenter not linked to any user is ignored as not linked', async () => {
    t.temporal.reset();
    const ref = await newTicket(c.p1);
    const res = await comment(c.p1, ref, { author: 'stranger', body: '/fix' });
    expect(res.json()).toEqual({ outcome: 'ignored_owner_unlinked' });
    expect(await runsOn(c.p1, ref)).toHaveLength(0);
    expect(await ignoredFor(c.p1, ref)).toMatchObject([{ outcome: 'ignored_owner_unlinked' }]);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
  });

  it("BR-53: a bot trigger during B's live run starts a follow-up run owned by B", async () => {
    await endAllRuns();
    const ref = await newTicket(c.p1);
    await comment(c.p1, ref, { author: 'own-b', body: '/fix' });
    const [origin] = await runsOn(c.p1, ref);
    await makeLive(origin?.id ?? '');
    t.temporal.reset();
    const res = await comment(c.p1, ref, {
      author: bot(),
      authorAssociation: '',
      body: '/second',
      createdAt: new Date().toISOString(),
    });
    expect(res.statusCode).toBe(202);
    const followUp = (await runsOn(c.p1, ref)).find((r) => r.id !== origin?.id);
    expect(followUp).toMatchObject({ ownerUserId: c.ids.b, originRunId: origin?.id });
    expect(await runDto(followUp?.id ?? '', c.b)).toMatchObject({ ownerUserId: c.ids.b });
    expect(t.temporal.callsOfKind('start')).toHaveLength(1);
  });

  describe('BR-71: a bot trigger without a single same-project origin', () => {
    const botComment = (p: { repoPath: string }, ref: string) =>
      comment(p, ref, { author: bot(), authorAssociation: '', body: '/second', createdAt: new Date().toISOString() });

    it('with no live run at all starts nothing', async () => {
      await endAllRuns();
      t.temporal.reset();
      const ref = await newTicket(c.p1);
      expect((await botComment(c.p1, ref)).json()).toEqual({ outcome: 'ignored_owner_unlinked' });
      expect(await runsOn(c.p1, ref)).toHaveLength(0);
      expect(await ignoredFor(c.p1, ref)).toMatchObject([{ outcome: 'ignored_owner_unlinked' }]);
      expect(t.temporal.callsOfKind('start')).toHaveLength(0);
    });

    it('whose only live run is in P1 while it comments on P2 starts nothing', async () => {
      await endAllRuns();
      const origin = await newTicket(c.p1);
      await comment(c.p1, origin, { author: 'own-b', body: '/fix' });
      await makeLive((await runsOn(c.p1, origin))[0]?.id ?? '');
      t.temporal.reset();
      const ref = await newTicket(c.p2);
      expect((await botComment(c.p2, ref)).json()).toEqual({ outcome: 'ignored_owner_unlinked' });
      expect(await runsOn(c.p2, ref)).toHaveLength(0);
      expect(await ignoredFor(c.p2, ref)).toMatchObject([{ outcome: 'ignored_owner_unlinked' }]);
      expect(t.temporal.callsOfKind('start')).toHaveLength(0);
    });

    it('whose origin run has no owner (owner set null by SQL) starts nothing', async () => {
      await endAllRuns();
      const ref = await newTicket(c.p1);
      await comment(c.p1, ref, { author: 'own-b', body: '/fix' });
      const [origin] = await runsOn(c.p1, ref);
      await makeLive(origin?.id ?? '');
      await admin.query('update runs set owner_user_id = null where id = $1', [origin?.id]);
      t.temporal.reset();
      expect((await botComment(c.p1, ref)).json()).toEqual({ outcome: 'ignored_owner_unlinked' });
      expect(await runsOn(c.p1, ref)).toHaveLength(1);
      expect(await ignoredFor(c.p1, ref)).toMatchObject([{ outcome: 'ignored_owner_unlinked' }]);
      expect(t.temporal.callsOfKind('start')).toHaveLength(0);
    });
  });

  it("BR-72: after B's P1 assignment is revoked, a bot trigger from B's earlier P1 run is not permitted", async () => {
    await endAllRuns();
    const ref = await newTicket(c.p1);
    await comment(c.p1, ref, { author: 'own-b', body: '/fix' });
    const [origin] = await runsOn(c.p1, ref);
    await makeLive(origin?.id ?? '');
    const revoked = await t.app.inject({
      method: 'DELETE',
      url: `/api/orgs/${c.orgId}/assignments/${c.p1Assignment}`,
      headers: { cookie: c.o },
    });
    expect(revoked.statusCode).toBe(204);
    t.temporal.reset();
    const res = await comment(c.p1, ref, {
      author: bot(),
      authorAssociation: '',
      body: '/second',
      createdAt: new Date().toISOString(),
    });
    expect(res.json()).toEqual({ outcome: 'ignored_owner_not_permitted' });
    expect(await runsOn(c.p1, ref)).toHaveLength(1);
    expect(await ignoredFor(c.p1, ref)).toMatchObject([{ outcome: 'ignored_owner_not_permitted' }]);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
  });

  it("N6: an unlinked human comment naming a live run's id still gets no owner", async () => {
    await endAllRuns();
    const ref = await newTicket(c.p2);
    await comment(c.p2, ref, { author: 'own-b', body: '/fix' });
    const [origin] = await runsOn(c.p2, ref);
    await makeLive(origin?.id ?? '');
    t.temporal.reset();
    const res = await comment(c.p2, ref, {
      author: 'stranger',
      body: `/second ${origin?.id}`,
      createdAt: new Date().toISOString(),
    });
    expect(res.json()).toEqual({ outcome: 'ignored_owner_unlinked' });
    expect(await runsOn(c.p2, ref)).toHaveLength(1);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
  });
});
