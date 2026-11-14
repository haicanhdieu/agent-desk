import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowNotFoundError } from '@temporalio/client';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { setupTestEvents, setupTests, withOrg } from '@agentdesk/db';
import { SIGNAL, TASK_QUEUE, WORKFLOW, setupTestWorkflowId } from '@agentdesk/core';
import { RunEventDto, SetupTestDto } from '@agentdesk/contracts';
import { SetupTestStream } from '../src/setup/setup-test-stream';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { expectContract } from './helpers/contract';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let base: string;
let alice: string;
let bob: string;
let carol: string;
let aliceOrg: string;
let connectionId: string;
let projectId: string;
let stream: SetupTestStream;

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  t = await createTestApp({
    env: { FAKE_STATE_DIR: freshStateDir(), SSE_HEARTBEAT_MS: '100' },
    wrapAdapters: wideFakeRepos,
  });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
  stream = t.app.get(SetupTestStream);
  stream.pollMs = 50;
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  carol = await loginAs(t, 'carol');
  connectionId = await installFake(t, alice);
  aliceOrg = ((await t.db.pool.query("select id from organization where slug = 'alice'")).rows[0] as { id: string }).id;
  // carol is a plain member of alice's org (neither its owner nor the project's creator), with it as her active org.
  await t.db.pool.query(
    `insert into member (id, organization_id, user_id, role, created_at)
     select $2, $1, id, 'member', now() from "user" where handle = 'carol'`,
    [aliceOrg, randomUUID()],
  );
  await t.db.pool.query(
    `update session set active_organization_id = $1 where user_id = (select id from "user" where handle = 'carol')`,
    [aliceOrg],
  );
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  t.temporal.reset();
  projectId = (await makeProject(t, alice, connectionId)).projectId;
});

const create = (script: string | object, cookie = alice, id = projectId) =>
  t.app.inject({
    method: 'POST',
    url: `/api/projects/${id}/setup-tests`,
    headers: { cookie },
    payload: typeof script === 'string' ? { script } : script,
  });
const latest = (cookie = alice, id = projectId) =>
  t.app.inject({ method: 'GET', url: `/api/projects/${id}/setup-tests/latest`, headers: { cookie } });
const end = (testId: string, cookie = alice) =>
  t.app.inject({ method: 'POST', url: `/api/setup-tests/${testId}/end`, headers: { cookie } });
const created = async (script = 'echo hi', cookie = alice): Promise<SetupTestDto> =>
  expectContract('setupTests.create', await create(script, cookie)) as SetupTestDto;

/** The project's tests oldest first, read as the org (RLS), including the stored script text. */
const rowsOf = (): Promise<Array<{ id: string; endedAt: Date | null; scriptBody: string | null }>> =>
  withOrg(t.db, aliceOrg, (tx) =>
    tx
      .select({ id: setupTests.id, endedAt: setupTests.endedAt, scriptBody: setupTests.scriptBody })
      .from(setupTests)
      .where(eq(setupTests.projectId, projectId))
      .orderBy(asc(setupTests.createdAt)),
  );
const activeIds = async (): Promise<string[]> => (await rowsOf()).filter((r) => r.endedAt === null).map((r) => r.id);

/** Stand-in for the worker's finalize: marks the row ended (the API itself never writes `ended_at`). */
const finalize = (testId: string): Promise<void> =>
  withOrg(t.db, aliceOrg, async (tx) => {
    await tx
      .update(setupTests)
      .set({ status: 'ended', endedAt: new Date(), scriptBody: null })
      .where(eq(setupTests.id, testId));
  });

describe('setup test create', () => {
  it('returns a queued test and starts the workflow with { orgId, setupTestId } only', async () => {
    const script = 'echo SECRET_MARKER_123 && make test';
    const res = await create(script);
    expect(res.statusCode).toBe(200);
    const dto = SetupTestDto.parse(expectContract('setupTests.create', res));
    expect(dto).toMatchObject({
      projectId,
      status: 'queued',
      scriptSha256: sha(script),
      matchesCurrentScript: false,
      checkoutSha: null,
      exitCode: null,
      startedBy: 'alice',
      finishedAt: null,
      endedAt: null,
      endsAt: null,
      plugins: { installed: [], skipped: [], failed: [] },
    });
    expect(res.body).not.toContain('SECRET_MARKER_123');
    const starts = t.temporal.callsOfKind('start');
    expect(starts).toHaveLength(1);
    const call = starts[0];
    expect(call?.workflowId).toBe(setupTestWorkflowId(dto.id));
    expect(call?.args[0]).toBe(WORKFLOW.setupTest);
    const options = call?.args[1] as { taskQueue: string; args: unknown[] };
    expect(options.taskQueue).toBe(TASK_QUEUE);
    expect(options.args).toEqual([{ orgId: aliceOrg, setupTestId: dto.id }]);
    expect(JSON.stringify(call)).not.toContain('SECRET_MARKER_123');
    expect((await rowsOf()).map((r) => r.scriptBody)).toEqual([script]);
  });

  it('allows an empty script, and matchesCurrentScript treats no saved script as empty', async () => {
    const dto = await created('');
    expect(dto.scriptSha256).toBe(sha(''));
    expect(dto.matchesCurrentScript).toBe(true);
  });

  it('rejects a script over 64 KiB (UTF-8 bytes) with 400 and accepts exactly 64 KiB', async () => {
    expect((await create('a'.repeat(65537))).statusCode).toBe(400);
    expect((await create('é'.repeat(32768) + 'a')).statusCode).toBe(400);
    expect((await create({})).statusCode).toBe(400);
    expect((await create('a'.repeat(65536))).statusCode).toBe(200);
  });

  it('rejects a script with a NUL character with 400', async () => {
    expect((await create('a\u0000b')).statusCode).toBe(400);
  });

  it('is 403 for an org member who is neither owner nor project creator, 404 for another org', async () => {
    expect((await create('x', carol)).statusCode).toBe(403);
    expect((await create('x', bob)).statusCode).toBe(404);
    expect(t.temporal.callsOfKind('start')).toHaveLength(0);
    expect(await rowsOf()).toHaveLength(0);
  });

  it('audit row carries sha256 and bytes, never the script', async () => {
    const script = 'echo AUDIT_MARKER ☃';
    const dto = await created(script);
    const rows = await withOrg(t.db, aliceOrg, (tx) =>
      tx.execute(
        sql`select payload from audit_log where action = 'POST setupTests.create' and target_id = ${projectId}`,
      ),
    );
    expect(rows.rows).toHaveLength(1);
    const payload = (rows.rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload).toEqual({ sha256: sha(script), bytes: Buffer.byteLength(script, 'utf8') });
    expect(JSON.stringify(payload)).not.toContain('AUDIT_MARKER');
    expect(dto.scriptSha256).toBe(sha(script));
  });

  it('starting a test ends the previous one (sequential)', async () => {
    const first = await created('echo 1');
    expect(t.temporal.callsOfKind('signal')).toHaveLength(0);
    const second = await created('echo 2');
    const signals = t.temporal.callsOfKind('signal');
    expect(signals.map((c) => c.workflowId)).toEqual([setupTestWorkflowId(first.id)]);
    expect(signals[0]?.args).toEqual([SIGNAL.endSetupTest]);
    // The worker's finalize sets ended_at on the signalled test; afterwards exactly the new one is active.
    await finalize(first.id);
    expect(await activeIds()).toEqual([second.id]);
  });

  it('starting a test ends the previous one (parallel creates are serialised by the project lock)', async () => {
    const results = await Promise.all([create('p1'), create('p2'), create('p3')]);
    const dtos = results.map((r) => expectContract('setupTests.create', r) as SetupTestDto);
    const byCreation = (await rowsOf()).map((r) => r.id);
    expect(byCreation).toHaveLength(3);
    expect(new Set(byCreation)).toEqual(new Set(dtos.map((d) => d.id)));
    const newest = byCreation[2] ?? '';
    const signalled = new Set(t.temporal.callsOfKind('signal').map((c) => c.workflowId));
    // Every test but the one that committed last was signalled; the last one never was.
    expect(signalled).toEqual(new Set(byCreation.slice(0, 2).map(setupTestWorkflowId)));
    expect(signalled.has(setupTestWorkflowId(newest))).toBe(false);
    // Stand in for each signalled workflow's finalize; exactly one active test remains, the newest.
    for (const id of byCreation.slice(0, 2)) await finalize(id);
    expect(await activeIds()).toEqual([newest]);
    expect(t.temporal.callsOfKind('start')).toHaveLength(3);
  });

  it('still starts the new workflow when signalling the previous one fails, logging no message', async () => {
    await created('echo 1');
    t.temporal.signalHook = async () => {
      throw new Error('boom SIGNAL_SECRET');
    };
    const res = await create('echo 2');
    expect(res.statusCode).toBe(200);
    expect(t.temporal.callsOfKind('start')).toHaveLength(2);
  });
});

const notFound = (workflowId: string | undefined): WorkflowNotFoundError =>
  new WorkflowNotFoundError('workflow not found (fake)', workflowId ?? '', undefined);

const setStatus = (testId: string, status: string): Promise<void> =>
  withOrg(t.db, aliceOrg, async (tx) => {
    await tx.update(setupTests).set({ status }).where(eq(setupTests.id, testId));
  });

const rowOf = async (testId: string) => (await rowsOfFull()).find((r) => r.id === testId);
const rowsOfFull = (): Promise<
  Array<{ id: string; status: string; endedAt: Date | null; scriptBody: string | null }>
> =>
  withOrg(t.db, aliceOrg, (tx) =>
    tx
      .select({
        id: setupTests.id,
        status: setupTests.status,
        endedAt: setupTests.endedAt,
        scriptBody: setupTests.scriptBody,
      })
      .from(setupTests)
      .where(eq(setupTests.projectId, projectId)),
  );

describe('superseded setup tests whose workflow is gone', () => {
  it.each(['queued', 'running'])('closes a previous %s test when its workflow is not found', async (status) => {
    const prev = await created('echo prev');
    await setStatus(prev.id, status);
    t.temporal.signalFailure = (id) => notFound(id);
    const next = await created('echo next');
    const row = await rowOf(prev.id);
    expect(row?.endedAt).not.toBeNull();
    expect(row?.scriptBody).toBeNull();
    expect(row?.status).toBe('ended');
    // The new test is untouched and is what latest returns.
    const fresh = await rowOf(next.id);
    expect(fresh).toMatchObject({ status: 'queued', endedAt: null, scriptBody: 'echo next' });
    expect(SetupTestDto.parse(expectContract('setupTests.latest', await latest())).id).toBe(next.id);
    expect(await activeIds()).toEqual([next.id]);
  });

  it.each(['passed', 'failed'])('closes a previous %s test without changing its status', async (status) => {
    const prev = await created('echo prev');
    await setStatus(prev.id, status);
    t.temporal.signalFailure = (id) => notFound(id);
    await created('echo next');
    const row = await rowOf(prev.id);
    expect(row?.status).toBe(status);
    expect(row?.endedAt).not.toBeNull();
    expect(row?.scriptBody).toBeNull();
  });

  it('leaves a previous test alone when its signal succeeds', async () => {
    const prev = await created('echo prev');
    await created('echo next');
    expect(await rowOf(prev.id)).toMatchObject({ status: 'queued', endedAt: null, scriptBody: 'echo prev' });
  });

  it('leaves a previous test alone on a signal error other than not-found, and still returns 200', async () => {
    const prev = await created('echo prev');
    t.temporal.signalFailure = () => new Error('unavailable SIGNAL_SECRET');
    const res = await create('echo next');
    expect(res.statusCode).toBe(200);
    expect(await rowOf(prev.id)).toMatchObject({ status: 'queued', endedAt: null, scriptBody: 'echo prev' });
  });

  it('parallel creates: a signal reaching Temporal before the earlier start leaves only the newest active', async () => {
    const started = new Set<string>();
    let release: () => void = () => undefined;
    const signalled = new Promise<void>((r) => {
      release = r;
    });
    let firstStart = true;
    t.temporal.signalFailure = (id) => {
      if (id !== undefined && started.has(id)) return undefined;
      release();
      return notFound(id);
    };
    t.temporal.startHook = async (id) => {
      // The first start is held back until a later create's signal has hit the not-yet-started workflow.
      if (firstStart) {
        firstStart = false;
        await Promise.race([signalled, sleep(3000)]);
      }
      if (id !== undefined) started.add(id);
    };
    const results = await Promise.all([create('p1'), create('p2')]);
    for (const r of results) expectContract('setupTests.create', r);
    const ordered = await rowsOf();
    expect(ordered).toHaveLength(2);
    expect(await activeIds()).toEqual([ordered[1]?.id]);
    expect(ordered[0]?.scriptBody).toBeNull();
  });

  it('closes the row, clears the script and leaks no script text when the workflow cannot be started', async () => {
    t.temporal.startError = new Error('start failed START_SECRET_MARKER');
    const res = await create('echo START_SECRET_MARKER');
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.body).not.toContain('START_SECRET_MARKER');
    const rows = await rowsOfFull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ended', scriptBody: null });
    expect(rows[0]?.endedAt).not.toBeNull();
  });
});

describe('setup test latest', () => {
  it('is null before any test, then the newest row; matchesCurrentScript follows the saved script', async () => {
    expect(expectContract('setupTests.latest', await latest())).toBeNull();
    await created('echo old');
    const newest = await created('echo new');
    const first = SetupTestDto.parse(expectContract('setupTests.latest', await latest()));
    expect(first.id).toBe(newest.id);
    expect(first.matchesCurrentScript).toBe(false);
    const put = await t.app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/setup-script`,
      headers: { cookie: alice },
      payload: { body: 'echo new', baseVersion: null },
    });
    expect(put.statusCode).toBe(200);
    expect(SetupTestDto.parse(expectContract('setupTests.latest', await latest())).matchesCurrentScript).toBe(true);
    await t.app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/setup-script`,
      headers: { cookie: alice },
      payload: { body: 'echo different', baseVersion: 1 },
    });
    const after = await latest();
    expect(SetupTestDto.parse(expectContract('setupTests.latest', after)).matchesCurrentScript).toBe(false);
    expect(after.body).not.toContain('echo new');
  });

  it('computes endsAt from finishedAt + SETUP_TEST_TTL_SECONDS only while not ended', async () => {
    const dto = await created();
    const finishedAt = new Date('2026-01-01T00:00:00.000Z');
    await withOrg(t.db, aliceOrg, (tx) =>
      tx.update(setupTests).set({ status: 'passed', finishedAt }).where(eq(setupTests.id, dto.id)),
    );
    const live = SetupTestDto.parse(expectContract('setupTests.latest', await latest()));
    expect(live.status).toBe('passed');
    expect(live.endsAt).toBe(new Date(finishedAt.getTime() + t.config.SETUP_TEST_TTL_SECONDS * 1000).toISOString());
    await finalize(dto.id);
    const done = SetupTestDto.parse(expectContract('setupTests.latest', await latest()));
    expect(done.endsAt).toBeNull();
    expect(done.endedAt).not.toBeNull();
  });

  it('is readable by any org member, 404 for another org', async () => {
    await created();
    expect((await latest(carol)).statusCode).toBe(200);
    expect((await latest(bob)).statusCode).toBe(404);
  });
});

describe('setup test end', () => {
  it('signals endSetupTest for the creator, 403 for a non-creator member, 404 for another org', async () => {
    const dto = await created();
    t.temporal.reset();
    expect((await end(dto.id, carol)).statusCode).toBe(403);
    expect((await end(dto.id, bob)).statusCode).toBe(404);
    expect((await end(randomUUID())).statusCode).toBe(404);
    expect(t.temporal.callsOfKind('signal')).toHaveLength(0);
    const ok = await end(dto.id);
    expect(ok.statusCode).toBeLessThan(300);
    expectContract('setupTests.end', ok);
    const signals = t.temporal.callsOfKind('signal');
    expect(signals.map((c) => c.workflowId)).toEqual([setupTestWorkflowId(dto.id)]);
    expect(signals[0]?.args).toEqual([SIGNAL.endSetupTest]);
  });

  it('closes a queued test whose workflow does not exist (never started), keeping a recorded result', async () => {
    const dto = await created('echo orphan');
    t.temporal.signalFailure = (id) => notFound(id);
    const res = await end(dto.id);
    expect(res.statusCode).toBeLessThan(300);
    expect(await rowOf(dto.id)).toMatchObject({ status: 'ended', scriptBody: null });
    expect((await rowOf(dto.id))?.endedAt).not.toBeNull();
    const done = await created('echo done');
    await setStatus(done.id, 'passed');
    expect((await end(done.id)).statusCode).toBeLessThan(300);
    expect(await rowOf(done.id)).toMatchObject({ status: 'passed', scriptBody: null });
  });
});

interface Stream {
  status: number;
  messages: EventSourceMessage[];
  closed: Promise<void>;
  waitFor: (pred: (m: EventSourceMessage[]) => boolean, ms?: number) => Promise<void>;
  abort: () => void;
}

async function open(path: string, cookie: string): Promise<Stream> {
  const ac = new AbortController();
  const res = await fetch(`${base}${path}`, { headers: { cookie }, signal: ac.signal });
  const messages: EventSourceMessage[] = [];
  const parser = createParser({ onEvent: (m) => messages.push(m) });
  const closed = (async () => {
    if (!res.body || res.status !== 200) return;
    try {
      const decoder = new TextDecoder();
      for await (const chunk of res.body) parser.feed(decoder.decode(chunk as Uint8Array, { stream: true }));
    } catch {
      // aborted
    }
  })();
  const waitFor: Stream['waitFor'] = async (pred, ms = 5000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (pred(messages)) return;
      await sleep(20);
    }
    throw new Error(`timed out; got ${JSON.stringify(messages)}`);
  };
  return { status: res.status, messages, closed, waitFor, abort: () => ac.abort() };
}

const ofType = (ms: EventSourceMessage[], type: string): EventSourceMessage[] => ms.filter((m) => m.event === type);

async function addEvent(testId: string, seq: number, payload: Record<string, unknown> = { n: seq }): Promise<void> {
  await withOrg(t.db, aliceOrg, async (tx) => {
    await tx.insert(setupTestEvents).values({ orgId: aliceOrg, setupTestId: testId, seq, type: 'lifecycle', payload });
  });
}

describe('setup test events stream', () => {
  it('sends status, the backlog after `after`, then live updates, and closes once ended', async () => {
    const dto = await created('echo STREAM_SECRET');
    for (const seq of [1, 2, 3]) await addEvent(dto.id, seq);
    const s = await open(`/api/setup-tests/${dto.id}/events?after=1`, alice);
    expect(s.status).toBe(200);
    await s.waitFor((m) => ofType(m, 'event').length >= 2);
    expect(s.messages[0]?.event).toBe('status');
    expect(SetupTestDto.parse(JSON.parse(s.messages[0]?.data ?? '')).status).toBe('queued');
    const backlog = ofType(s.messages, 'event').map((m) => RunEventDto.parse(JSON.parse(m.data)));
    expect(backlog.map((e) => e.seq)).toEqual([2, 3]);
    expect(ofType(s.messages, 'event').map((m) => m.id)).toEqual(['2', '3']);

    // Live: a new event and a status change show up by polling.
    await addEvent(dto.id, 4, { phase: 'setup' });
    await withOrg(t.db, aliceOrg, (tx) =>
      tx.update(setupTests).set({ status: 'running' }).where(eq(setupTests.id, dto.id)),
    );
    await s.waitFor((m) => ofType(m, 'event').length >= 3 && ofType(m, 'status').length >= 2);
    expect(RunEventDto.parse(JSON.parse(ofType(s.messages, 'event')[2]?.data ?? '')).payload).toEqual({
      phase: 'setup',
    });
    expect(SetupTestDto.parse(JSON.parse(ofType(s.messages, 'status')[1]?.data ?? '')).status).toBe('running');

    // Ending sends the final event and status, then the stream closes by itself.
    await addEvent(dto.id, 5);
    await finalize(dto.id);
    await s.closed;
    expect(ofType(s.messages, 'event').map((m) => m.id)).toEqual(['2', '3', '4', '5']);
    const lastStatus = SetupTestDto.parse(JSON.parse(ofType(s.messages, 'status').at(-1)?.data ?? ''));
    expect(lastStatus.status).toBe('ended');
    expect(lastStatus.endedAt).not.toBeNull();
    expect(JSON.stringify(s.messages)).not.toContain('STREAM_SECRET');
  });

  it('on an already ended test sends the whole backlog and closes', async () => {
    const dto = await created();
    await addEvent(dto.id, 1);
    await addEvent(dto.id, 2);
    await finalize(dto.id);
    const s = await open(`/api/setup-tests/${dto.id}/events`, carol);
    await s.closed;
    expect(s.status).toBe(200);
    expect(ofType(s.messages, 'event')).toHaveLength(2);
    expect(ofType(s.messages, 'status')).toHaveLength(1);
  });

  it('is 404 for another org, 400 for a bad id, and never starts a stream', async () => {
    const dto = await created();
    expect((await open(`/api/setup-tests/${dto.id}/events`, bob)).status).toBe(404);
    expect((await open(`/api/setup-tests/${randomUUID()}/events`, alice)).status).toBe(404);
    expect((await open(`/api/setup-tests/nope/events`, alice)).status).toBe(400);
  });

  it('stops polling and releases the stream when the client disconnects', async () => {
    const dto = await created();
    let polls = 0;
    stream.hooks.onPoll = () => {
      polls += 1;
    };
    const s = await open(`/api/setup-tests/${dto.id}/events`, alice);
    await s.waitFor((m) => ofType(m, 'status').length >= 1);
    await sleep(200);
    expect(stream.openStreams()).toBe(1);
    expect(polls).toBeGreaterThan(0);
    s.abort();
    const deadline = Date.now() + 2000;
    while (stream.openStreams() > 0 && Date.now() < deadline) await sleep(20);
    expect(stream.openStreams()).toBe(0);
    await sleep(100);
    const settled = polls;
    await sleep(300);
    stream.hooks.onPoll = undefined;
    expect(polls).toBe(settled);
  });
});

describe('setup test rows are scoped by org (RLS)', () => {
  it('hides another org’s tests from a direct query under withOrg', async () => {
    const dto = await created();
    const bobOrg = ((await t.db.pool.query("select id from organization where slug = 'bob'")).rows[0] as { id: string })
      .id;
    const seen = await withOrg(t.db, bobOrg, (tx) =>
      tx
        .select({ id: setupTests.id })
        .from(setupTests)
        .where(and(eq(setupTests.id, dto.id), sql`true`)),
    );
    expect(seen).toHaveLength(0);
  });
});
