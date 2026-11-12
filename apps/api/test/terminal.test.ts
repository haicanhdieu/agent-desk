import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { runs, withOrg } from '@agentdesk/db';
import {
  FakeKubeGateway,
  SIGNAL,
  buildRunJob,
  runWorkflowId,
  type ExecSession,
  type KubeGateway,
} from '@agentdesk/core';
import { TerminalGateway } from '../src/terminal/terminal.gateway';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const ORIGIN = 'http://localhost:5173';
const resizes: Array<[number, number]> = [];

let t: TestApp;
let stateDir: string;
let real: FakeKubeGateway;
let wsBase: string;
let alice: string;
let bob: string;
let carol: string;
let aliceOrg: string;
let aliceProject: string;
const jobs: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(25);
  }
}

const orgIdOf = async (slug: string): Promise<string> =>
  ((await t.db.pool.query('select id from organization where slug = $1', [slug])).rows[0] as { id: string }).id;

/** A gateway that records every resize the relay makes, otherwise the real file-backed fake. */
function spy(inner: KubeGateway): KubeGateway {
  return Object.assign<KubeGateway, Pick<KubeGateway, 'exec'>>(Object.create(inner), {
    exec: async (pod, cmd, opts): Promise<ExecSession> => {
      const s = await inner.exec(pod, cmd, opts);
      return {
        write: (d) => s.write(d),
        resize: (c, r) => {
          resizes.push([c, r]);
          s.resize(c, r);
        },
        onData: (cb) => s.onData(cb),
        onClose: (cb) => s.onClose(cb),
        close: () => s.close(),
      };
    },
  });
}

beforeAll(async () => {
  stateDir = freshStateDir();
  real = new FakeKubeGateway(join(stateDir, 'kube'), { turnMs: 100 });
  t = await createTestApp({
    env: { FAKE_STATE_DIR: stateDir, TERMINAL_PING_MS: '150' },
    wrapAdapters: wideFakeRepos,
    kube: spy(real),
  });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  wsBase = `ws://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  carol = await loginAs(t, 'carol');
  aliceProject = (await makeProject(t, alice, await installFake(t, alice))).projectId;
  aliceOrg = await orgIdOf('alice');
  // carol is a plain member of alice's org (not the project's creator, not the owner), with it as her active org.
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
  await real.killAll();
  await t.close();
  rmSync(stateDir, { recursive: true, force: true });
});

/** Inserts a run row and (unless `pod` is false) starts its fake pod, waiting until it is Running. */
async function makeRun(status: string, pod = true): Promise<string> {
  const id = await withOrg(t.db, aliceOrg, async (tx) => {
    const [row] = await tx
      .insert(runs)
      .values({
        orgId: aliceOrg,
        projectId: aliceProject,
        command: 'fix',
        skillName: 'fix',
        ticketRef: `term-${randomUUID()}`,
        ticketKind: 'issue',
        checkoutRef: 'refs/heads/main',
        triggerSource: 'webhook',
        status,
      })
      .returning({ id: runs.id });
    if (!row) throw new Error('no row');
    return row.id;
  });
  if (pod) {
    await real.ensureJob(
      buildRunJob({
        runId: id,
        orgId: aliceOrg,
        projectId: aliceProject,
        image: 'fake',
        prompt: 'do it',
        checkoutRef: 'main',
        cloneUrlSecretKey: 'REPO_CLONE_URL',
        maxTurns: null,
        timeoutSeconds: 120,
        botName: 'bot',
        botEmail: 'bot@x.invalid',
        pod: {
          cpuRequest: '1',
          cpuLimit: '1',
          memoryRequest: '1Gi',
          memoryLimit: '1Gi',
          ephemeralStorageLimit: '1Gi',
          workspaceSizeLimit: '1Gi',
        },
      }),
    );
    jobs.push(`run-${id}`);
    await until(async () => (await real.getRunPod(`run-${id}`))?.phase === 'Running');
  }
  return id;
}

interface Client {
  ws: WebSocket;
  bytes: () => string;
  closed: Promise<number>;
  opened: Promise<void>;
}

function connect(
  runId: string,
  opts: { cookie?: string; origin?: string | null; path?: string; autoPong?: boolean } = {},
): Client {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.origin !== null) headers['origin'] = opts.origin ?? ORIGIN;
  const ws = new WebSocket(`${wsBase}${opts.path ?? `/api/runs/${runId}/terminal`}`, {
    headers,
    autoPong: opts.autoPong ?? true,
  });
  let buf = Buffer.alloc(0);
  ws.on('message', (d: Buffer, isBinary: boolean) => {
    if (isBinary) buf = Buffer.concat([buf, d]);
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  const opened = new Promise<void>((resolve) => ws.on('open', () => resolve()));
  ws.on('error', () => undefined);
  return { ws, bytes: () => buf.toString('utf8'), closed, opened };
}

const signalsFor = (runId: string, name: string) =>
  t.temporal.callsOfKind('signal').filter((c) => c.workflowId === runWorkflowId(runId) && c.args[0] === name);

describe('terminal relay', () => {
  it('closes 4401 without a session', async () => {
    const runId = await makeRun('running');
    const c = connect(runId);
    expect(await c.closed).toBe(4401);
  });

  it('closes 4401 with a garbage session cookie', async () => {
    const runId = await makeRun('running', false);
    expect(await connect(runId, { cookie: 'better-auth.session_token=nope' }).closed).toBe(4401);
  });

  it("closes 4403 for another org's run, and does not distinguish it from a missing run", async () => {
    const runId = await makeRun('running');
    expect(await connect(runId, { cookie: bob }).closed).toBe(4403);
    expect(await connect(randomUUID(), { cookie: alice }).closed).toBe(4403);
    expect(await connect('not-a-uuid', { cookie: alice, path: '/api/runs/not-a-uuid/terminal' }).closed).toBe(4403);
  });

  it('closes 4403 for an org member who is neither the project creator nor the org owner', async () => {
    const runId = await makeRun('running');
    expect(await connect(runId, { cookie: carol }).closed).toBe(4403);
  });

  it('closes 4403 on an Origin that is not PUBLIC_ORIGIN (cross-site WebSocket hijacking)', async () => {
    const runId = await makeRun('running');
    expect(await connect(runId, { cookie: alice, origin: 'http://evil.example' }).closed).toBe(4403);
    expect(await connect(runId, { cookie: alice, origin: 'http://localhost:5173.evil.example' }).closed).toBe(4403);
    expect(t.temporal.callsOfKind('signal').filter((c) => c.workflowId === runWorkflowId(runId))).toHaveLength(0);
  });

  it('closes 4409 for a finished run', async () => {
    const runId = await makeRun('succeeded', false);
    expect(await connect(runId, { cookie: alice }).closed).toBe(4409);
  });

  it('closes 4409 when the run is running but its pod is gone', async () => {
    const runId = await makeRun('running', false);
    expect(await connect(runId, { cookie: alice }).closed).toBe(4409);
  });

  it('attaches: receives the pane banner and echoes typed input', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    c.ws.send(Buffer.from('hi\r'), { binary: true });
    await until(() => c.bytes().includes('hi'));
    c.ws.close();
    await c.closed;
  });

  it('forwards a resize text frame to the session, and ignores malformed ones', async () => {
    const runId = await makeRun('running');
    resizes.length = 0;
    const c = connect(runId, { cookie: alice });
    await c.opened;
    c.ws.send('{"type":"resize","cols":0,"rows":40}');
    c.ws.send('{"type":"resize","cols":501,"rows":40}');
    c.ws.send('{"type":"resize","cols":1.5,"rows":40}');
    c.ws.send('not json');
    c.ws.send('{"type":"other"}');
    c.ws.send('{"type":"resize","cols":120,"rows":40}');
    await until(() => resizes.length > 0);
    expect(resizes).toEqual([[120, 40]]);
    c.ws.close();
    await c.closed;
  });

  it('signals terminalAttached on open and terminalDetached exactly once on close', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => signalsFor(runId, SIGNAL.terminalAttached).length === 1);
    c.ws.close();
    await c.closed;
    await until(() => signalsFor(runId, SIGNAL.terminalDetached).length > 0);
    await sleep(150);
    expect(signalsFor(runId, SIGNAL.terminalDetached)).toHaveLength(1);
    expect(signalsFor(runId, SIGNAL.resumed)).toHaveLength(0);
  });

  it('a signal failure does not break the relay', async () => {
    const runId = await makeRun('running');
    t.temporal.failing = true;
    try {
      const c = connect(runId, { cookie: alice });
      await c.opened;
      await until(() => c.bytes().length > 0);
      c.ws.close();
      await c.closed;
    } finally {
      t.temporal.failing = false;
    }
  });

  it('two inputs within 5 s while idle signal resumed once; a running run never does', async () => {
    const idle = await makeRun('idle');
    const c = connect(idle, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    c.ws.send(Buffer.from('a'), { binary: true });
    c.ws.send(Buffer.from('b'), { binary: true });
    await until(() => signalsFor(idle, SIGNAL.resumed).length > 0);
    c.ws.send(Buffer.from('c'), { binary: true });
    await sleep(300);
    expect(signalsFor(idle, SIGNAL.resumed)).toHaveLength(1);
    c.ws.close();
    await c.closed;

    const running = await makeRun('running');
    const d = connect(running, { cookie: alice });
    await d.opened;
    d.ws.send(Buffer.from('x'), { binary: true });
    await sleep(300);
    expect(signalsFor(running, SIGNAL.resumed)).toHaveLength(0);
    d.ws.close();
    await d.closed;
  });

  it('closes 1009 on an oversized frame', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    c.ws.send(Buffer.alloc(70 * 1024, 1), { binary: true });
    expect(await c.closed).toBe(1009);
    await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 1);
  });

  it('pings the client on an interval', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    let pings = 0;
    c.ws.on('ping', () => (pings += 1));
    await c.opened;
    await until(() => pings >= 2);
    c.ws.close();
    await c.closed;
  });

  it('terminates a client that stops answering pings', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice, autoPong: false });
    await c.opened;
    await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 1, 4000);
    expect(await c.closed).toBe(1006);
  });

  it('closes 1000 when the run ends (pod exit)', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    await real.deleteJob(`run-${runId}`);
    expect(await c.closed).toBe(1000);
  });

  it('caps concurrent terminals per run', async () => {
    const runId = await makeRun('running');
    const open: Client[] = [];
    for (let i = 0; i < 4; i += 1) {
      const c = connect(runId, { cookie: alice });
      await c.opened;
      await until(() => c.bytes().length > 0);
      open.push(c);
    }
    const extra = connect(runId, { cookie: alice });
    expect(await extra.closed).toBe(1013);
    for (const c of open) {
      c.ws.close();
      await c.closed;
    }
  });

  it('closes open terminals with 1001 on module destroy', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    const gateway = t.app.get(TerminalGateway);
    expect(gateway.openCount()).toBeGreaterThan(0);
    gateway.onModuleDestroy();
    expect(await c.closed).toBe(1001);
    expect(gateway.openCount()).toBe(0);
  });
});
