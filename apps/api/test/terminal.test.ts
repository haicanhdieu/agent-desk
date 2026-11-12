import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { projects, runs, withOrg } from '@agentdesk/db';
import {
  FakeKubeGateway,
  SIGNAL,
  buildRunJob,
  runWorkflowId,
  type ExecSession,
  type KubeGateway,
} from '@agentdesk/core';
import { AUTH } from '../src/auth/auth';
import { TerminalGateway } from '../src/terminal/terminal.gateway';
import { createTestApp, type TestApp } from './helpers/app';
import { loginAs } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const ORIGIN = 'http://localhost:5173';
const resizes: Array<[number, number]> = [];
let execCalls = 0;
const expectNoExec = (): void => expect(execCalls, 'exec must never be reached on a denial').toBe(0);

let t: TestApp;
let stateDir: string;
let real: FakeKubeGateway;
let wsBase: string;
let alice: string;
let bob: string;
let carol: string;
let aliceOrg: string;
let aliceProject: string;
let aliceConn: string;
let carolId: string;
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
      execCalls += 1;
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
    env: { FAKE_STATE_DIR: stateDir, TERMINAL_PING_MS: '150', TERMINAL_REAUTH_MS: '200' },
    wrapAdapters: wideFakeRepos,
    kube: spy(real),
  });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  wsBase = `ws://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
  alice = await loginAs(t, 'alice');
  bob = await loginAs(t, 'bob');
  carol = await loginAs(t, 'carol');
  aliceConn = await installFake(t, alice);
  aliceProject = (await makeProject(t, alice, aliceConn)).projectId;
  aliceOrg = await orgIdOf('alice');
  carolId = ((await t.db.pool.query(`select id from "user" where handle = 'carol'`)).rows[0] as { id: string }).id;
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
async function makeRun(status: string, pod = true, projectId = aliceProject): Promise<string> {
  const id = await withOrg(t.db, aliceOrg, async (tx) => {
    const [row] = await tx
      .insert(runs)
      .values({
        orgId: aliceOrg,
        projectId,
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
        projectId,
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
  beforeEach(() => {
    execCalls = 0;
    resizes.length = 0;
    t.temporal.reset();
  });

  it('closes 4401 without a session', async () => {
    const runId = await makeRun('running');
    const c = connect(runId);
    expect(await c.closed).toBe(4401);
    expectNoExec();
  });

  it('closes 4401 with a garbage session cookie', async () => {
    const runId = await makeRun('running', false);
    expect(await connect(runId, { cookie: 'better-auth.session_token=nope' }).closed).toBe(4401);
    expectNoExec();
  });

  it("closes 4403 for another org's run, and does not distinguish it from a missing run", async () => {
    const runId = await makeRun('running');
    expect(await connect(runId, { cookie: bob }).closed).toBe(4403);
    expect(await connect(randomUUID(), { cookie: alice }).closed).toBe(4403);
    expect(await connect('not-a-uuid', { cookie: alice, path: '/api/runs/not-a-uuid/terminal' }).closed).toBe(4403);
    expectNoExec();
  });

  it('closes 4403 for an org member who is neither the project creator nor the org owner', async () => {
    const runId = await makeRun('running');
    expect(await connect(runId, { cookie: carol }).closed).toBe(4403);
    expectNoExec();
  });

  it('authorizes project creator and org owner individually', async () => {
    // A second project in alice's org whose creator is carol (a plain member); alice is the org owner, not its creator.
    const p2 = (await makeProject(t, alice, aliceConn)).projectId;
    await withOrg(t.db, aliceOrg, (tx) => tx.update(projects).set({ createdBy: carolId }).where(eq(projects.id, p2)));
    const run = await makeRun('running', true, p2);

    const creator = connect(run, { cookie: carol });
    await creator.opened;
    await until(() => creator.bytes().length > 0); // member who IS the creator: allowed
    creator.ws.close();
    await creator.closed;

    const owner = connect(run, { cookie: alice });
    await owner.opened;
    await until(() => owner.bytes().length > 0); // owner who is NOT the creator: allowed
    owner.ws.close();
    await owner.closed;

    // plain member, not creator (aliceProject was created by alice): denied
    const denied = await makeRun('running');
    const before = execCalls;
    expect(await connect(denied, { cookie: carol }).closed).toBe(4403);
    expect(execCalls).toBe(before);
  });

  it('a thrown session lookup closes 1011 (only a null session is 4401) and never reaches exec', async () => {
    const runId = await makeRun('running');
    const auth = t.app.get(AUTH);
    const spyOn = vi.spyOn(auth.api, 'getSession').mockRejectedValueOnce(new Error('auth backend down'));
    try {
      expect(await connect(runId, { cookie: alice }).closed).toBe(1011);
    } finally {
      spyOn.mockRestore();
    }
    expectNoExec();
  });

  it('signals attached before detached even when the attach signal is slow and the socket closes at once', async () => {
    const runId = await makeRun('running');
    t.temporal.signalHook = async (name) => {
      if (name === SIGNAL.terminalAttached) await sleep(300);
    };
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    c.ws.close();
    await c.closed;
    await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 1);
    const order = t.temporal
      .callsOfKind('signal')
      .filter((x) => x.workflowId === runWorkflowId(runId))
      .map((x) => x.args[0]);
    expect(order).toEqual([SIGNAL.terminalAttached, SIGNAL.terminalDetached]);
  });

  it('sends no detach when the attach signal failed (counting stays balanced), and retries a failing detach', async () => {
    const gateway = t.app.get(TerminalGateway);
    gateway.signalRetryMs = 10;
    try {
      const failed = await makeRun('running');
      t.temporal.signalHook = async (name) => {
        if (name === SIGNAL.terminalAttached) throw new Error('boom');
      };
      const c = connect(failed, { cookie: alice });
      await c.opened;
      await until(() => c.bytes().length > 0);
      c.ws.close();
      await c.closed;
      await sleep(400);
      expect(signalsFor(failed, SIGNAL.terminalDetached)).toHaveLength(0);

      const flaky = await makeRun('running');
      let detachTries = 0;
      t.temporal.signalHook = async (name) => {
        if (name === SIGNAL.terminalDetached && (detachTries += 1) < 3) throw new Error('boom');
      };
      const d = connect(flaky, { cookie: alice });
      await d.opened;
      await until(() => d.bytes().length > 0);
      d.ws.close();
      await d.closed;
      await until(() => signalsFor(flaky, SIGNAL.terminalDetached).length === 1);
      expect(detachTries).toBe(3);
    } finally {
      gateway.signalRetryMs = 100;
    }
  });

  it('re-validates the session on a live socket: a revoked session closes 4401', async () => {
    const runId = await makeRun('running');
    const cookie = await loginAs(t, 'alice'); // a second session, so the shared alice cookie stays valid
    const token = (
      (
        await t.db.pool.query(
          `select token from session where user_id = (select id from "user" where handle = 'alice') order by created_at desc limit 1`,
        )
      ).rows[0] as { token: string }
    ).token;
    const c = connect(runId, { cookie });
    await c.opened;
    await until(() => c.bytes().length > 0);
    await t.db.pool.query('delete from session where token = $1', [token]);
    expect(await c.closed).toBe(4401);
    await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 1);
  });

  it('re-validates membership on a live socket: a removed member closes 4403; an auth outage does not close', async () => {
    const runId = await makeRun('running');
    const gina = await loginAs(t, 'gina');
    await t.db.pool.query(
      `insert into member (id, organization_id, user_id, role, created_at)
       select $2, $1, id, 'owner', now() from "user" where handle = 'gina'`,
      [aliceOrg, randomUUID()],
    );
    await t.db.pool.query(
      `update session set active_organization_id = $1 where user_id = (select id from "user" where handle = 'gina')`,
      [aliceOrg],
    );
    const c = connect(runId, { cookie: gina });
    await c.opened;
    await until(() => c.bytes().length > 0);

    const auth = t.app.get(AUTH);
    const outage = vi.spyOn(auth.api, 'getSession').mockRejectedValue(new Error('auth backend down'));
    await sleep(700); // several reauth ticks during the outage
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    outage.mockRestore();

    await t.db.pool.query(
      `delete from member where user_id = (select id from "user" where handle = 'gina') and organization_id = $1`,
      [aliceOrg],
    );
    expect(await c.closed).toBe(4403);
  });

  it('closes 4403 on an Origin that is not PUBLIC_ORIGIN (cross-site WebSocket hijacking)', async () => {
    const runId = await makeRun('running');
    expect(await connect(runId, { cookie: alice, origin: 'http://evil.example' }).closed).toBe(4403);
    expect(await connect(runId, { cookie: alice, origin: 'http://localhost:5173.evil.example' }).closed).toBe(4403);
    expect(t.temporal.callsOfKind('signal').filter((c) => c.workflowId === runWorkflowId(runId))).toHaveLength(0);
    expectNoExec();
  });

  it('closes 4409 for a finished run', async () => {
    const runId = await makeRun('succeeded', false);
    expect(await connect(runId, { cookie: alice }).closed).toBe(4409);
    expectNoExec();
  });

  it('closes 4409 when the run is running but its pod is gone', async () => {
    const runId = await makeRun('running', false);
    expect(await connect(runId, { cookie: alice }).closed).toBe(4409);
    expectNoExec();
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
