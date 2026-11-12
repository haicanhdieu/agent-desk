import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { runs, withOrg } from '@agentdesk/db';
import { FAKE_SIGNATURE_HEADER, FakeStore, fakeSignature } from '@agentdesk/core';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let alice: string;
let projectId: string;
let repoPath: string;
let orgId: string;
let externalId: string;
let admin: pg.Pool;
let stateDir: string;

beforeAll(async () => {
  stateDir = freshStateDir();
  t = await createTestApp({ env: { FAKE_STATE_DIR: stateDir }, wrapAdapters: wideFakeRepos });
  const u = new URL(t.pg.adminUrl);
  u.pathname = '/agentdesk';
  admin = new pg.Pool({ connectionString: u.toString() });
  alice = await loginAs(t, 'alice');
  ({ projectId, repoPath } = await makeProject(t, alice, await installFake(t, alice)));
  orgId = ((await t.db.pool.query("select id from organization where slug = 'alice'")).rows[0] as { id: string }).id;
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
    payload: { command: 'fix', labelFilter: [], target: 'any', skillName: 'fix', enabled: true },
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

    const again = await w.send();
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ outcome: 'duplicate' });
    expect(t.temporal.callsOfKind('start')).toHaveLength(1);
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
      payload: { command: 'lbl', labelFilter: ['bug'], target: 'any', skillName: 'fix', enabled: true },
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
      payload: { command: 'other', labelFilter: [], target: 'any', skillName: 'fix', enabled: true },
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
      deliver: 'webhook',
      projectId,
    });
    expect(c.statusCode).toBe(201);
    const body = c.json() as { outcome: string; runId: string; commentId: string };
    expect(body.outcome).toBe('run_created');
    const [row] = await withOrg(t.db, orgId, (tx) => tx.select().from(runs).where(eq(runs.id, body.runId)));
    expect(row).toMatchObject({
      ticketTitle: 'Dev ticket',
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
      const cookie = await loginAs(off, 'carol');
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
