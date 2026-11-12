import { randomUUID } from 'node:crypto';
import { connect, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { eq, sql } from 'drizzle-orm';
import { notifyRunStatus, runEvents, runs, withOrg } from '@agentdesk/db';
import { ProjectRunEvent, RunEventMessage, RunStatusEvent } from '@agentdesk/contracts';
import { RunStatusListener } from '../src/sse/run-status-listener';
import { SseService } from '../src/sse/sse.service';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

let t: TestApp;
let base: string;
let alice: string;
let bob: string;
let aliceOrg: string;
let bobOrg: string;
let aliceProject: string;
let bobProject: string;

const orgIdOf = async (slug: string): Promise<string> =>
  ((await t.db.pool.query('select id from organization where slug = $1', [slug])).rows[0] as { id: string }).id;

beforeAll(async () => {
  t = await createTestApp({
    env: { FAKE_STATE_DIR: freshStateDir(), SSE_HEARTBEAT_MS: '100' },
    wrapAdapters: wideFakeRepos,
  });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  aliceProject = (await makeProject(t, alice, await installFake(t, alice))).projectId;
  bobProject = (await makeProject(t, bob, await installFake(t, bob))).projectId;
  aliceOrg = await orgIdOf('alice');
  bobOrg = await orgIdOf('bob');
});
afterAll(async () => {
  await t.close();
});

let n = 0;
async function insertRun(orgId: string, projectId: string, status = 'running'): Promise<string> {
  n += 1;
  return withOrg(t.db, orgId, async (tx) => {
    const [row] = await tx
      .insert(runs)
      .values({
        orgId,
        projectId,
        command: 'fix',
        skillName: 'fix',
        ticketRef: `sse-${n}`,
        ticketKind: 'issue',
        checkoutRef: 'refs/heads/main',
        triggerSource: 'webhook',
        status,
      })
      .returning({ id: runs.id });
    if (!row) throw new Error('no row');
    return row.id;
  });
}

/** Stand-in for the worker's setRunStatus: append a run_event, update the run and NOTIFY in one transaction. */
async function commit(
  orgId: string,
  runId: string,
  status: string,
  opts: { type?: 'status' | 'lifecycle'; payload?: Record<string, unknown>; notifyOrg?: string } = {},
): Promise<number> {
  return withOrg(t.db, orgId, async (tx) => {
    const max = (
      await tx
        .select({ m: sql<number>`coalesce(max(${runEvents.seq}), 0)::int` })
        .from(runEvents)
        .where(eq(runEvents.runId, runId))
    )[0];
    const seq = (max?.m ?? 0) + 1;
    await tx
      .insert(runEvents)
      .values({ orgId, runId, seq, type: opts.type ?? 'status', payload: opts.payload ?? { status } });
    await tx
      .update(runs)
      .set({ status, ...(status === 'failed' ? { exitCode: 2, failureReason: 'boom' } : {}) })
      .where(eq(runs.id, runId));
    await notifyRunStatus(tx, { orgId: opts.notifyOrg ?? orgId, runId, seq });
    return seq;
  });
}

async function addEvents(orgId: string, runId: string, count: number, blob?: string): Promise<void> {
  await withOrg(t.db, orgId, async (tx) => {
    for (let seq = 1; seq <= count; seq += 1) {
      await tx
        .insert(runEvents)
        .values({ orgId, runId, seq, type: 'lifecycle', payload: blob === undefined ? { n: seq } : { n: seq, blob } });
    }
  });
}

interface Stream {
  status: number;
  headers: Headers;
  messages: EventSourceMessage[];
  raw: string;
  closed: Promise<void>;
  waitFor: (pred: (m: EventSourceMessage[]) => boolean, ms?: number) => Promise<EventSourceMessage[]>;
  abort: () => void;
}

async function open(path: string, cookie: string, headers: Record<string, string> = {}): Promise<Stream> {
  const ac = new AbortController();
  const res = await fetch(`${base}${path}`, { headers: { cookie, ...headers }, signal: ac.signal });
  const messages: EventSourceMessage[] = [];
  let raw = '';
  const parser = createParser({
    onEvent: (m) => messages.push(m),
    onComment: (c) => messages.push({ event: 'comment', data: c }),
  });
  const closed = (async () => {
    if (!res.body || res.status !== 200) return;
    try {
      const decoder = new TextDecoder();
      for await (const chunk of res.body) {
        const text = decoder.decode(chunk as Uint8Array, { stream: true });
        raw += text;
        parser.feed(text);
      }
    } catch {
      // aborted
    }
  })();
  const waitFor: Stream['waitFor'] = async (pred, ms = 5000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (pred(messages)) return messages;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out; got ${JSON.stringify(messages)}`);
  };
  return {
    status: res.status,
    headers: res.headers,
    messages,
    get raw() {
      return raw;
    },
    closed,
    waitFor,
    abort: () => ac.abort(),
  };
}

const ofType = (ms: EventSourceMessage[], type: string): EventSourceMessage[] => ms.filter((m) => m.event === type);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('run events stream', () => {
  it('sends headers, a status frame first, then only backlog events after `after`', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    await addEvents(aliceOrg, runId, 5);
    const s = await open(`/api/runs/${runId}/events?after=2`, alice);
    try {
      expect(s.status).toBe(200);
      expect(s.headers.get('content-type')).toContain('text/event-stream');
      expect(s.headers.get('cache-control')).toBe('no-cache');
      expect(s.headers.get('x-accel-buffering')).toBe('no');
      await s.waitFor((m) => ofType(m, 'event').length >= 3);
      await sleep(100);
      expect(s.messages[0]?.event).toBe('status');
      const status = RunStatusEvent.parse(JSON.parse(s.messages[0]?.data ?? ''));
      expect(status).toMatchObject({ runId, status: 'running', seq: 5, exitCode: null, failureReason: null });
      const evs = ofType(s.messages, 'event');
      expect(evs.map((e) => e.id)).toEqual(['3', '4', '5']);
      expect(RunEventMessage.parse(JSON.parse(evs[0]?.data ?? '')).seq).toBe(3);
    } finally {
      s.abort();
    }
  });

  it('pages a large backlog in order without gaps or duplicates', async () => {
    const runId = await insertRun(aliceOrg, aliceProject, 'succeeded');
    await addEvents(aliceOrg, runId, 1203);
    const s = await open(`/api/runs/${runId}/events`, alice);
    await s.closed;
    const ids = ofType(s.messages, 'event').map((e) => Number(e.id));
    expect(ids).toEqual(Array.from({ length: 1203 }, (_, i) => i + 1));
    expect(ofType(s.messages, 'status')).toHaveLength(1);
  });

  it('treats Last-Event-ID as after, and `after` wins over the header', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    await addEvents(aliceOrg, runId, 5);
    const viaHeader = await open(`/api/runs/${runId}/events`, alice, { 'last-event-id': '3' });
    const both = await open(`/api/runs/${runId}/events?after=4`, alice, { 'last-event-id': '1' });
    try {
      await viaHeader.waitFor((m) => ofType(m, 'event').length >= 2);
      await both.waitFor((m) => ofType(m, 'event').length >= 1);
      await sleep(100);
      expect(ofType(viaHeader.messages, 'event').map((e) => e.id)).toEqual(['4', '5']);
      expect(ofType(both.messages, 'event').map((e) => e.id)).toEqual(['5']);
    } finally {
      viaHeader.abort();
      both.abort();
    }
  });

  it('delivers a commit made during the stream as status (and its event), without duplicating the backlog', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    await addEvents(aliceOrg, runId, 2);
    const s = await open(`/api/runs/${runId}/events`, alice);
    try {
      await s.waitFor((m) => ofType(m, 'event').length >= 2);
      const seq = await commit(aliceOrg, runId, 'idle');
      const ms = await s.waitFor((m) => ofType(m, 'status').some((x) => x.data.includes('"idle"')));
      const live = RunStatusEvent.parse(JSON.parse(ofType(ms, 'status').at(-1)?.data ?? ''));
      expect(live).toMatchObject({ runId, status: 'idle', seq });
      expect(ofType(ms, 'event').map((e) => e.id)).toEqual(['1', '2', String(seq)]);
    } finally {
      s.abort();
    }
  });

  it('closes the stream after a final status', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const s = await open(`/api/runs/${runId}/events`, alice);
    await s.waitFor((m) => ofType(m, 'status').length >= 1);
    await commit(aliceOrg, runId, 'failed');
    await s.waitFor((m) => ofType(m, 'status').some((x) => x.data.includes('"failed"')));
    await s.closed;
    const last = RunStatusEvent.parse(JSON.parse(ofType(s.messages, 'status').at(-1)?.data ?? ''));
    expect(last).toMatchObject({ status: 'failed', exitCode: 2, failureReason: 'boom' });
  });

  it('sends the backlog then closes for an already-final run', async () => {
    const runId = await insertRun(aliceOrg, aliceProject, 'succeeded');
    await addEvents(aliceOrg, runId, 2);
    const s = await open(`/api/runs/${runId}/events`, alice);
    await s.closed;
    expect(s.messages.map((m) => m.event)).toEqual(['status', 'event', 'event']);
  });

  it("returns 404 problem+json for another org's run, and 401 without a session", async () => {
    const runId = await insertRun(bobOrg, bobProject);
    const res = await fetch(`${base}/api/runs/${runId}/events`, { headers: { cookie: alice } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const missing = await fetch(`${base}/api/runs/${randomUUID()}/events`, { headers: { cookie: alice } });
    expect(missing.status).toBe(404);
    const anon = await fetch(`${base}/api/runs/${runId}/events`);
    expect(anon.status).toBe(401);
    const bad = await fetch(`${base}/api/runs/${runId}/events?after=-1`, { headers: { cookie: bob } });
    expect(bad.status).toBe(400);
  });

  it('emits heartbeat comments', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const s = await open(`/api/runs/${runId}/events`, alice);
    try {
      await s.waitFor((m) => m.filter((x) => x.event === 'comment' && x.data.trim() === 'ping').length >= 2);
      expect(s.raw).toContain(': ping\n\n');
    } finally {
      s.abort();
    }
  });

  it('never delivers another org its events, even when a notification names a foreign org or run', async () => {
    const aliceRun = await insertRun(aliceOrg, aliceProject);
    const bobRun = await insertRun(bobOrg, bobProject);
    const s = await open(`/api/runs/${aliceRun}/events`, alice);
    const p = await open(`/api/projects/${aliceProject}/events`, alice);
    try {
      await s.waitFor((m) => ofType(m, 'status').length >= 1);
      await commit(bobOrg, bobRun, 'idle');
      // Forged: alice's org id with bob's run id, and bob's org id with alice's run id.
      await withOrg(t.db, aliceOrg, (tx) => notifyRunStatus(tx, { orgId: aliceOrg, runId: bobRun, seq: 1 }));
      await withOrg(t.db, bobOrg, (tx) => notifyRunStatus(tx, { orgId: bobOrg, runId: aliceRun, seq: 1 }));
      await sleep(400);
      expect(ofType(s.messages, 'status')).toHaveLength(1);
      expect(ofType(s.messages, 'event')).toHaveLength(0);
      expect(ofType(p.messages, 'run')).toHaveLength(0);
    } finally {
      s.abort();
      p.abort();
    }
  });
});

describe('project events stream', () => {
  it('emits ProjectRunEvent for status changes in the project only', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const other = await insertRun(aliceOrg, (await makeProject(t, alice, await installFake(t, alice))).projectId);
    const s = await open(`/api/projects/${aliceProject}/events`, alice);
    try {
      expect(s.status).toBe(200);
      expect(s.headers.get('content-type')).toContain('text/event-stream');
      await sleep(100);
      await commit(aliceOrg, other, 'idle');
      const seq = await commit(aliceOrg, runId, 'idle');
      await s.waitFor((m) => ofType(m, 'run').length >= 1);
      await sleep(200);
      const runsSeen = ofType(s.messages, 'run').map((m) => ProjectRunEvent.parse(JSON.parse(m.data)));
      expect(runsSeen).toHaveLength(1);
      const number = (await withOrg(t.db, aliceOrg, (tx) => tx.select().from(runs).where(eq(runs.id, runId))))[0]
        ?.number;
      expect(runsSeen[0]).toEqual({ runId, number, status: 'idle', seq });
    } finally {
      s.abort();
    }
  });

  it("returns 404 for another org's project", async () => {
    const res = await fetch(`${base}/api/projects/${bobProject}/events`, { headers: { cookie: alice } });
    expect(res.status).toBe(404);
  });

  it('removes subscribers when clients disconnect', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const streams = await Promise.all([
      open(`/api/runs/${runId}/events`, alice),
      open(`/api/projects/${aliceProject}/events`, alice),
    ]);
    await sleep(100);
    streams.forEach((s) => s.abort());
    await sleep(200);
    expect(t.app.get(SseService).openStreams()).toBe(0);
  });
});

describe('fix round 1', () => {
  const sse = (): SseService => t.app.get(SseService);
  const listener = (): RunStatusListener => t.app.get(RunStatusListener);
  afterAll(() => {
    sse().hooks = {};
    listener().hooks = {};
  });

  it('does not lose a final status committed between the initial read and the flush', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    sse().hooks.afterFirstRead = async (id) => {
      if (id !== runId) return;
      await commit(aliceOrg, runId, 'failed');
      await sleep(400);
    };
    try {
      const s = await open(`/api/runs/${runId}/events`, alice);
      await Promise.race([s.closed, sleep(5000).then(() => Promise.reject(new Error('stream hung')))]);
      const last = RunStatusEvent.parse(JSON.parse(ofType(s.messages, 'status').at(-1)?.data ?? ''));
      expect(last.status).toBe('failed');
    } finally {
      sse().hooks = {};
    }
  });

  it('cleans up when the client disconnects during the initial read', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const ac = new AbortController();
    sse().hooks.afterFirstRead = async (id) => {
      if (id !== runId) return;
      await sleep(100);
      ac.abort();
      await sleep(300);
    };
    try {
      await fetch(`${base}/api/runs/${runId}/events`, { headers: { cookie: alice }, signal: ac.signal }).catch(
        () => null,
      );
      await sleep(500);
      expect(sse().openStreams()).toBe(0);
      expect(listener().subscriberCount()).toBe(0);
    } finally {
      sse().hooks = {};
    }
  });

  it('rejects an out-of-range `after` with 400 /after and ignores an over-range Last-Event-ID', async () => {
    const runId = await insertRun(aliceOrg, aliceProject, 'succeeded');
    await addEvents(aliceOrg, runId, 3);
    const res = await fetch(`${base}/api/runs/${runId}/events?after=3000000000`, { headers: { cookie: alice } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors?: Array<{ pointer: string }> };
    expect(body.errors?.[0]?.pointer).toBe('/after');
    const s = await open(`/api/runs/${runId}/events`, alice, { 'last-event-id': '3000000000' });
    await s.closed;
    expect(s.status).toBe(200);
    expect(ofType(s.messages, 'event').map((e) => e.id)).toEqual(['1', '2', '3']);
  });

  it('delivers a large backlog fully to a slow reader', async () => {
    const runId = await insertRun(aliceOrg, aliceProject, 'succeeded');
    await addEvents(aliceOrg, runId, 600, 'x'.repeat(4096));
    const res = await fetch(`${base}/api/runs/${runId}/events`, { headers: { cookie: alice } });
    const ids: string[] = [];
    const parser = createParser({ onEvent: (m) => m.event === 'event' && ids.push(m.id ?? '') });
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true }));
      await sleep(2);
    }
    expect(ids).toHaveLength(600);
    expect(ids[599]).toBe('600');
  }, 30000);

  it('recovers a final status committed while the LISTEN connection is down', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const s = await open(`/api/runs/${runId}/events`, alice);
    await s.waitFor((m) => ofType(m, 'status').length >= 1);
    await t.db.pool.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where query like 'LISTEN run_status%' and pid <> pg_backend_pid()",
    );
    await commit(aliceOrg, runId, 'failed');
    await Promise.race([s.closed, sleep(10000).then(() => Promise.reject(new Error('stream hung')))]);
    expect(ofType(s.messages, 'status').at(-1)?.data).toContain('"failed"');
  }, 20000);

  it('coalesces a burst of notifications, and does not read for run-only subscribers', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const burst = async (): Promise<void> => {
      await Promise.all(
        Array.from({ length: 20 }, () =>
          withOrg(t.db, aliceOrg, (tx) => notifyRunStatus(tx, { orgId: aliceOrg, runId, seq: 1 })),
        ),
      );
      await sleep(600);
    };
    const runOnly = await open(`/api/runs/${runId}/events`, alice);
    try {
      await runOnly.waitFor((m) => ofType(m, 'status').length >= 1);
      const before = listener().readCount;
      await burst();
      expect(listener().readCount).toBe(before);
    } finally {
      runOnly.abort();
    }
    const proj = await open(`/api/projects/${aliceProject}/events`, alice);
    try {
      await sleep(100);
      listener().hooks.beforeRead = () => sleep(200);
      const before = listener().readCount;
      await burst();
      expect(listener().readCount - before).toBeLessThanOrEqual(2);
      expect(listener().readCount - before).toBeGreaterThanOrEqual(1);
    } finally {
      listener().hooks = {};
      proj.abort();
    }
  });
});

describe('fix round 2', () => {
  it('drops a client that stays connected but never reads', async () => {
    const svc = t.app.get(SseService);
    const runId = await insertRun(aliceOrg, aliceProject);
    await addEvents(aliceOrg, runId, 3000, 'x'.repeat(4096));
    const before = svc.drainTimeoutMs;
    svc.drainTimeoutMs = 300;
    const port = (t.app.getHttpServer().address() as AddressInfo).port;
    const socket = connect(port, '127.0.0.1');
    try {
      await new Promise<void>((r) => socket.once('connect', () => r()));
      socket.write(`GET /api/runs/${runId}/events HTTP/1.1\r\nHost: x\r\nCookie: ${alice}\r\n\r\n`);
      socket.pause();
      const opened = Date.now() + 3000;
      while (Date.now() < opened && svc.openStreams() === 0) await sleep(10);
      expect(svc.openStreams()).toBe(1);
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline && (svc.openStreams() > 0 || t.app.get(RunStatusListener).subscriberCount() > 0)) {
        await sleep(50);
      }
      expect(svc.openStreams()).toBe(0);
      expect(t.app.get(RunStatusListener).subscriberCount()).toBe(0);
    } finally {
      svc.drainTimeoutMs = before;
      socket.destroy();
    }
  }, 30000);

  it('re-sends a run that finished while the LISTEN connection was down', async () => {
    const runId = await insertRun(aliceOrg, aliceProject);
    const s = await open(`/api/projects/${aliceProject}/events`, alice);
    try {
      await sleep(100);
      await commit(aliceOrg, runId, 'idle');
      await s.waitFor((m) => ofType(m, 'run').length >= 1);
      await t.db.pool.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where query like 'LISTEN run_status%' and pid <> pg_backend_pid()",
      );
      await commit(aliceOrg, runId, 'failed');
      await s.waitFor((m) => ofType(m, 'run').some((x) => x.data.includes('"failed"')), 10000);
      const frames = ofType(s.messages, 'run')
        .map((m) => ProjectRunEvent.parse(JSON.parse(m.data)))
        .filter((f) => f.runId === runId);
      expect(frames.at(-1)?.status).toBe('failed');
    } finally {
      s.abort();
    }
  }, 20000);
});
