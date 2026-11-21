import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { projects, runs, setupTests, withOrg } from '@agentdesk/db';
import {
  FakeKubeGateway,
  SIGNAL,
  buildRunJob,
  buildSetupTestJob,
  runWorkflowId,
  setupTestJobName,
  type ExecSession,
  type KubeGateway,
} from '@agentdesk/core';
import { AUTH } from '../src/auth/auth';
import { TerminalGateway } from '../src/terminal/terminal.gateway';
import { createTestApp, type TestApp } from './helpers/app';
import { createOrg, inviteAndLogin, loginAs, userIdOf } from './helpers/auth';
import { freshStateDir, installFake, makeProject, wideFakeRepos } from './helpers/fixtures';

const ORIGIN = 'http://localhost:5173';
const resizes: Array<[number, number]> = [];
let execCalls = 0;
/** Every command the relay exec'd, in order. */
const execLog: string[][] = [];
/** Replaces the exec result for matching commands (e.g. a session that closes with a given exit code). */
let execOverride: ((cmd: string[]) => ExecSession | undefined) | undefined;
/** Makes `getRunPod` report Running even after the fake pod exited (the attach-on-exited-pod race). */
let stalePodRunning = false;
/** When set, a plain `tmux` exec (the old-pod fallback) waits for it before it starts. */
let fallbackGate: Promise<void> | undefined;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const closingSession = (code: number): ExecSession => ({
  write: () => undefined,
  resize: () => undefined,
  onData: () => undefined,
  onClose: (cb) => queueMicrotask(() => cb(code)),
  close: () => undefined,
});
const attachIds = (): string[] => execLog.filter((c) => c[0] === 'agentdesk-attach').map((c) => c[1] ?? '');
const detachIds = (): string[] => execLog.filter((c) => c[0] === 'agentdesk-detach').map((c) => c[1] ?? '');
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

/**
 * A test ends when its client sees the close, but the server's cleanup (which issues `agentdesk-detach`) can run just
 * after. Wait for it so a late detach is not counted against the next test's exec log.
 */
const previousSocketsCleanedUp = (): Promise<true> => until(() => t.app.get(TerminalGateway).openCount() === 0);

/** A gateway that records every resize the relay makes, otherwise the real file-backed fake. */
function spy(inner: KubeGateway): KubeGateway {
  return Object.assign<KubeGateway, Pick<KubeGateway, 'exec' | 'getRunPod'>>(Object.create(inner), {
    getRunPod: async (name) => {
      const pod = await inner.getRunPod(name);
      return pod && stalePodRunning ? { ...pod, phase: 'Running' } : pod;
    },
    exec: async (pod, cmd, opts): Promise<ExecSession> => {
      execCalls += 1;
      execLog.push([...cmd]);
      if (cmd[0] === 'tmux') await fallbackGate;
      const overridden = execOverride?.(cmd);
      if (overridden) return overridden;
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
  aliceOrg = (await createOrg(t, 'Alice', 'alice')).id;
  const bobOrg = (await createOrg(t, 'Bob', 'bob')).id;
  alice = await inviteAndLogin(t, aliceOrg, 'alice', 'owner', { type: 'org' });
  bob = await inviteAndLogin(t, bobOrg, 'bob', 'owner', { type: 'org' });
  // carol is a plain member of alice's org (not the project's creator, not the owner).
  carol = await inviteAndLogin(t, aliceOrg, 'carol', 'member', { type: 'org' });
  aliceConn = await installFake(t, alice);
  aliceProject = (await makeProject(t, alice, aliceConn)).projectId;
  carolId = await userIdOf(t, 'carol');
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
        agentEnv: [{ name: 'AGENT_MODEL', value: 'claude-opus-4-1' }],
        checkoutRef: 'main',
        credentialEnvKeys: [],
        gitUsername: 'x-access-token',
        gitHost: 'fake.invalid',
        cliTokenEnvName: 'GH_TOKEN',
        maxTurns: null,
        deadlineSeconds: 120,
        resume: false,
        botName: 'bot',
        botEmail: 'bot@x.invalid',
        author: { name: 'bot', email: 'bot@x.invalid', authorizedBy: 'bot' },
        pluginMarketplaces: {},
        setupTimeoutSeconds: 600,
        setupScript: null,
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
  beforeEach(async () => {
    await previousSocketsCleanedUp();
    execCalls = 0;
    execLog.length = 0;
    execOverride = undefined;
    stalePodRunning = false;
    fallbackGate = undefined;
    resizes.length = 0;
    t.temporal.reset();
    t.app.get(TerminalGateway).leaseIntervalMs = 120_000;
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
    const gina = await inviteAndLogin(t, aliceOrg, 'gina', 'owner', { type: 'org' });
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

  it('closes 4410 while the session is ending (sessionEndingAt set) and for a paused run, with no exec', async () => {
    const ending = await makeRun('idle');
    await withOrg(t.db, aliceOrg, (tx) =>
      tx.update(runs).set({ sessionEndingAt: new Date() }).where(eq(runs.id, ending)),
    );
    expect(await connect(ending, { cookie: alice }).closed).toBe(4410);
    const paused = await makeRun('paused', false);
    expect(await connect(paused, { cookie: alice }).closed).toBe(4410);
    expectNoExec();
  });

  it('refuses a socket of someone else with 4403 before it says anything about the ending session', async () => {
    const ending = await makeRun('idle');
    await withOrg(t.db, aliceOrg, (tx) =>
      tx.update(runs).set({ sessionEndingAt: new Date() }).where(eq(runs.id, ending)),
    );
    expect(await connect(ending, { cookie: carol }).closed).toBe(4403);
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

  it('terminal attach allowed for a done run', async () => {
    const runId = await makeRun('done');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
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

  it("attach and detach carry the socket's own connection id: the id of its attach client in the pod", async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => signalsFor(runId, SIGNAL.terminalAttached).length === 1);
    const id = attachIds().at(-1);
    expect(id).toMatch(UUID_RE);
    expect(signalsFor(runId, SIGNAL.terminalAttached)[0]?.args).toEqual([SIGNAL.terminalAttached, id]);
    c.ws.close();
    await c.closed;
    await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 1);
    expect(signalsFor(runId, SIGNAL.terminalDetached)[0]?.args).toEqual([SIGNAL.terminalDetached, id]);
  });

  describe('person input', () => {
    const type = (c: Client, text: string): void => c.ws.send(Buffer.from(text), { binary: true });
    const attached = async (runId: string): Promise<Client> => {
      const c = connect(runId, { cookie: alice });
      await c.opened;
      await until(() => signalsFor(runId, SIGNAL.terminalAttached).length === 1);
      return c;
    };

    it('signals personInput once, with no args, when a person types into a live run terminal', async () => {
      const runId = await makeRun('running');
      const c = await attached(runId);
      type(c, 'ls\r');
      await until(() => signalsFor(runId, SIGNAL.personInput).length === 1);
      expect(signalsFor(runId, SIGNAL.personInput)[0]?.args).toEqual([SIGNAL.personInput]);
      c.ws.close();
      await c.closed;
    });

    it('signals at most once per interval for a run, and again once the interval has passed', async () => {
      const gateway = t.app.get(TerminalGateway);
      try {
        const runId = await makeRun('running');
        const c = await attached(runId);
        type(c, 'a');
        type(c, 'b');
        await until(() => signalsFor(runId, SIGNAL.personInput).length === 1);
        await sleep(100);
        expect(signalsFor(runId, SIGNAL.personInput)).toHaveLength(1); // the default 60 s interval holds the second chunk back
        gateway.personInputIntervalMs = 0; // the interval has passed
        type(c, 'c');
        await until(() => signalsFor(runId, SIGNAL.personInput).length === 2);
        c.ws.close();
        await c.closed;
      } finally {
        gateway.personInputIntervalMs = 60_000;
      }
    });

    it('does not throttle a reconnect: the last socket closing resets the interval for that run', async () => {
      const runId = await makeRun('running');
      const first = await attached(runId);
      type(first, 'a');
      await until(() => signalsFor(runId, SIGNAL.personInput).length === 1);
      first.ws.close();
      await first.closed;
      await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 1);
      const second = connect(runId, { cookie: alice });
      await second.opened;
      await until(() => signalsFor(runId, SIGNAL.terminalAttached).length === 2);
      type(second, 'b');
      await until(() => signalsFor(runId, SIGNAL.personInput).length === 2);
      second.ws.close();
      await second.closed;
    });

    it('does not signal for a terminal reply (a cursor position report)', async () => {
      const runId = await makeRun('running');
      const c = await attached(runId);
      type(c, '\x1b[12;40R');
      await sleep(150);
      expect(signalsFor(runId, SIGNAL.personInput)).toHaveLength(0);
      type(c, 'x');
      await until(() => signalsFor(runId, SIGNAL.personInput).length === 1);
      c.ws.close();
      await c.closed;
    });

    it('does not signal for a socket refused by authorization', async () => {
      const runId = await makeRun('running');
      const noSession = connect(runId);
      noSession.ws.on('open', () => noSession.ws.send(Buffer.from('ls\r'), { binary: true }));
      expect(await noSession.closed).toBe(4401);
      const other = connect(runId, { cookie: carol });
      other.ws.on('open', () => other.ws.send(Buffer.from('ls\r'), { binary: true }));
      expect(await other.closed).toBe(4403);
      await sleep(150);
      expect(signalsFor(runId, SIGNAL.personInput)).toHaveLength(0);
    });

    it('keeps relaying when the personInput signal fails', async () => {
      const gateway = t.app.get(TerminalGateway);
      gateway.signalRetryMs = 5;
      gateway.personInputIntervalMs = 20;
      try {
        const runId = await makeRun('running');
        const c = await attached(runId);
        t.temporal.signalHook = async (name) => {
          if (name === SIGNAL.personInput) throw new Error('boom');
        };
        type(c, 'echo first\r');
        await until(() => c.bytes().includes('echo first'));
        await sleep(100);
        type(c, 'echo second\r');
        await until(() => c.bytes().includes('echo second'));
        expect(signalsFor(runId, SIGNAL.personInput)).toHaveLength(0);
        c.ws.close();
        await c.closed;
      } finally {
        gateway.signalRetryMs = 100;
        gateway.personInputIntervalMs = 60_000;
      }
    });
  });

  describe('attach leases', () => {
    const leaseIds = (runId: string): string[][] =>
      signalsFor(runId, SIGNAL.terminalLease).map((x) => (Array.isArray(x.args[1]) ? x.args[1].map(String) : []));

    it('sends the live ids of a run every interval, drops a closed socket, and stops after the last close', async () => {
      t.app.get(TerminalGateway).leaseIntervalMs = 100;
      const runId = await makeRun('running');
      const a = connect(runId, { cookie: alice });
      const b = connect(runId, { cookie: alice });
      await Promise.all([a.opened, b.opened]);
      await until(() => signalsFor(runId, SIGNAL.terminalAttached).length === 2);
      const ids = signalsFor(runId, SIGNAL.terminalAttached).map((x) => String(x.args[1]));
      expect(new Set(ids).size).toBe(2);
      // One signal per run per tick, holding both ids.
      await until(() => leaseIds(runId).some((l) => l.length === 2));
      expect(leaseIds(runId)[0]?.slice().sort()).toEqual(ids.slice().sort());

      a.ws.close();
      await a.closed;
      await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 1);
      const gone = String(signalsFor(runId, SIGNAL.terminalDetached)[0]?.args[1]);
      const before = leaseIds(runId).length;
      await until(() => leaseIds(runId).length >= before + 2);
      expect(
        leaseIds(runId)
          .slice(before)
          .every((l) => l.length === 1 && !l.includes(gone)),
      ).toBe(true);

      b.ws.close();
      await b.closed;
      await until(() => signalsFor(runId, SIGNAL.terminalDetached).length === 2);
      await sleep(250);
      const settled = leaseIds(runId).length;
      await sleep(400);
      expect(leaseIds(runId)).toHaveLength(settled);
    });

    it('sends nothing for a socket that was denied, and nothing for a socket whose attach signal failed', async () => {
      t.app.get(TerminalGateway).leaseIntervalMs = 50;
      const gateway = t.app.get(TerminalGateway);
      gateway.signalRetryMs = 5;
      try {
        const runId = await makeRun('running');
        expect(await connect(runId, { cookie: carol }).closed).toBe(4403);
        expect(await connect(runId).closed).toBe(4401);
        t.temporal.signalHook = async (name) => {
          if (name === SIGNAL.terminalAttached) throw new Error('boom');
        };
        const c = connect(runId, { cookie: alice });
        await c.opened;
        await until(() => c.bytes().length > 0);
        await sleep(300);
        c.ws.close();
        await c.closed;
        await sleep(100);
        expect(t.temporal.callsOfKind('signal').filter((x) => x.workflowId === runWorkflowId(runId))).toHaveLength(0);
      } finally {
        gateway.signalRetryMs = 100;
      }
    });
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

  it('terminal input never signals resumed: protocol replies and keystrokes do not start a turn', async () => {
    const idle = await makeRun('idle');
    const c = connect(idle, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    c.ws.send(Buffer.from('\u001b[>0;276;0c'), { binary: true }); // xterm.js answering tmux's DA2 query on attach
    c.ws.send(Buffer.from('a'), { binary: true });
    c.ws.send(Buffer.from('\r'), { binary: true });
    await sleep(300);
    expect(signalsFor(idle, SIGNAL.resumed)).toHaveLength(0);
    c.ws.close();
    await c.closed;
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

  it('each socket execs agentdesk-attach with its own server-made uuid', async () => {
    const runId = await makeRun('running');
    const a = connect(runId, { cookie: alice });
    const b = connect(runId, { cookie: alice });
    await Promise.all([a.opened, b.opened]);
    await until(() => attachIds().length === 2);
    const ids = attachIds();
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(UUID_RE);
    // Nothing in the URL or frames picks the id: it is not the run id either.
    expect(ids).not.toContain(runId);
    a.ws.close();
    b.ws.close();
    await Promise.all([a.closed, b.closed]);
    await until(() => detachIds().length === 2);
    expect([...detachIds()].sort()).toEqual([...ids].sort());
  });

  it('closes 4410 when the attach exec ends with exit 3 (no session)', async () => {
    const runId = await makeRun('running');
    execOverride = (cmd) => (cmd[0] === 'agentdesk-attach' ? closingSession(3) : undefined);
    expect(await connect(runId, { cookie: alice }).closed).toBe(4410);
    await until(() => detachIds().length === 1);
  });

  it('closes 4410 when the pod already exited but the pod lookup still says Running', async () => {
    const runId = await makeRun('running');
    stalePodRunning = true;
    const kill = await real.exec(`run-${runId}`, ['tmux', 'kill-session', '-t', 'agent'], { tty: false });
    await new Promise<number>((r) => kill.onClose(r));
    await until(async () => (await real.getRunPod(`run-${runId}`))?.phase !== 'Running');
    expect(await connect(runId, { cookie: alice }).closed).toBe(4410);
  });

  it('runs agentdesk-detach once with the same id on socket close', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => attachIds().length === 1);
    c.ws.close();
    await c.closed;
    await until(() => detachIds().length > 0);
    await sleep(150);
    expect(detachIds()).toEqual(attachIds());
  });

  it('runs agentdesk-detach once when the client vanishes without a close frame', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => attachIds().length === 1);
    c.ws.terminate();
    await c.closed;
    await until(() => detachIds().length > 0);
    await sleep(150);
    expect(detachIds()).toEqual(attachIds());
  });

  it('runs agentdesk-detach for every open socket on module destroy, once each', async () => {
    const runId = await makeRun('running');
    const a = connect(runId, { cookie: alice });
    const b = connect(runId, { cookie: alice });
    await Promise.all([a.opened, b.opened]);
    await until(() => attachIds().length === 2);
    await t.app.get(TerminalGateway).onModuleDestroy();
    await Promise.all([a.closed, b.closed]);
    await sleep(150);
    expect([...detachIds()].sort()).toEqual([...attachIds()].sort());
    expect(detachIds()).toHaveLength(2);
  });

  it('a failing detach exec never breaks the close', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => attachIds().length === 1);
    execOverride = (cmd) => {
      if (cmd[0] === 'agentdesk-detach') throw new Error('exec down');
      return undefined;
    };
    c.ws.close();
    await c.closed;
    await until(() => detachIds().length === 1);
  });

  it('retries once with plain tmux attach when agentdesk-attach is not found (old pod)', async () => {
    const runId = await makeRun('running');
    execOverride = (cmd) => (cmd[0] === 'agentdesk-attach' ? closingSession(127) : undefined);
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0); // the pane banner came through the fallback session
    expect(execLog.filter((x) => x[0] === 'tmux')).toEqual([['tmux', 'attach', '-t', 'agent']]);
    expect(attachIds()).toHaveLength(1);
    c.ws.close();
    await c.closed;
  });

  it('keeps input typed while the old-pod fallback attach starts and delivers it to the fallback session', async () => {
    const runId = await makeRun('running');
    let release!: () => void;
    fallbackGate = new Promise<void>((r) => (release = r));
    execOverride = (cmd) => (cmd[0] === 'agentdesk-attach' ? closingSession(127) : undefined);
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => execLog.some((x) => x[0] === 'tmux')); // the named attach exited 127, the fallback exec is pending
    c.ws.send(Buffer.from('typed-early\r'), { binary: true });
    await sleep(150);
    release();
    await until(() => c.bytes().includes('typed-early')); // the fake pane echoes what the fallback session received
    c.ws.close();
    await c.closed;
  });

  it('runs agentdesk-detach once, with the attach id, after a server-side socket error (oversized frame)', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => attachIds().length === 1);
    c.ws.send(Buffer.alloc(70 * 1024, 1), { binary: true }); // ws emits 'error' then 'close' on the server socket
    expect(await c.closed).toBe(1009);
    await until(() => detachIds().length > 0);
    await sleep(150);
    expect(detachIds()).toHaveLength(1);
    expect(detachIds()).toEqual(attachIds());
  });

  it('module destroy waits for the detach exec to finish, not just to start', async () => {
    const runId = await makeRun('running');
    const c = connect(runId, { cookie: alice });
    await c.opened;
    await until(() => attachIds().length === 1);
    let finish!: () => void;
    let closeCb: ((code: number) => void) | undefined;
    let closedCalls = 0;
    execOverride = (cmd) =>
      cmd[0] === 'agentdesk-detach'
        ? {
            ...closingSession(0),
            onClose: (cb) => {
              closeCb = cb;
              finish = () => cb(0);
            },
            close: () => void (closedCalls += 1),
          }
        : undefined;
    let destroyed = false;
    const done = t.app
      .get(TerminalGateway)
      .onModuleDestroy()
      .then(() => (destroyed = true));
    await until(() => closeCb !== undefined);
    await sleep(200);
    expect(destroyed).toBe(false);
    finish();
    await done;
    expect(closedCalls).toBe(1);
    await c.closed;
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

/** Inserts a setup_tests row and (unless `pod` is false) starts its fake pod, waiting until it is Running. */
async function makeSetupTest(
  status: string,
  opts: { pod?: boolean; ended?: boolean; projectId?: string; id?: string } = {},
): Promise<string> {
  const projectId = opts.projectId ?? aliceProject;
  const id = await withOrg(t.db, aliceOrg, async (tx) => {
    const [row] = await tx
      .insert(setupTests)
      .values({
        ...(opts.id ? { id: opts.id } : {}),
        orgId: aliceOrg,
        projectId,
        status,
        scriptSha256: 'x'.repeat(64),
        startedBy: 'alice',
        endedAt: opts.ended ? new Date() : null,
      })
      .returning({ id: setupTests.id });
    if (!row) throw new Error('no row');
    return row.id;
  });
  if (opts.pod ?? true) {
    await real.ensureJob(
      buildSetupTestJob({
        setupTestId: id,
        orgId: aliceOrg,
        projectId,
        image: 'fake',
        checkoutRef: 'main',
        script: 'echo hi',
        pluginMarketplaces: {},
        setupTimeoutSeconds: 600,
        botName: 'bot',
        botEmail: 'bot@x.invalid',
        gitUsername: 'x-access-token',
        gitHost: 'fake.invalid',
        cliTokenEnvName: 'GH_TOKEN',
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
    await until(async () => (await real.getRunPod(setupTestJobName(id)))?.phase === 'Running');
  }
  return id;
}

const stPath = (id: string): string => `/api/setup-tests/${id}/terminal`;
const connectSetup = (id: string, opts: { cookie?: string; origin?: string | null } = {}): Client =>
  connect(id, { ...opts, path: stPath(id) });

describe('terminal relay: setup tests', () => {
  beforeEach(async () => {
    await previousSocketsCleanedUp();
    execCalls = 0;
    execLog.length = 0;
    execOverride = undefined;
    stalePodRunning = false;
    fallbackGate = undefined;
    resizes.length = 0;
    t.temporal.reset();
    t.app.get(TerminalGateway).leaseIntervalMs = 120_000;
  });

  it('attaches end to end: typed input comes back, and no workflow is signalled (no lease either)', async () => {
    t.app.get(TerminalGateway).leaseIntervalMs = 50;
    const id = await makeSetupTest('running');
    const c = connectSetup(id, { cookie: alice });
    await c.opened;
    await until(() => execCalls === 1);
    c.ws.send(Buffer.from('echo hi\r'), { binary: true });
    await until(() => c.bytes().includes('echo hi'));
    c.ws.close();
    await c.closed;
    await sleep(300);
    expect(t.temporal.callsOfKind('signal')).toHaveLength(0);
  });

  it('does not signal personInput when a person types into a setup-test terminal', async () => {
    const id = await makeSetupTest('running');
    const c = connectSetup(id, { cookie: alice });
    await c.opened;
    await until(() => execCalls === 1);
    c.ws.send(Buffer.from('ls\r'), { binary: true });
    await until(() => c.bytes().includes('ls'));
    await sleep(150);
    expect(t.temporal.callsOfKind('signal')).toHaveLength(0);
    c.ws.close();
    await c.closed;
  });

  it('a passed test whose workspace is still up is attachable', async () => {
    const id = await makeSetupTest('passed');
    const c = connectSetup(id, { cookie: alice });
    await c.opened;
    await until(() => c.bytes().length > 0);
    c.ws.close();
    await c.closed;
  });

  it('closes 4401 without a session', async () => {
    const id = await makeSetupTest('running');
    expect(await connectSetup(id).closed).toBe(4401);
    expectNoExec();
  });

  it('closes 4403 for a member who is not the project creator, and for another org, alike', async () => {
    const id = await makeSetupTest('running');
    expect(await connectSetup(id, { cookie: carol }).closed).toBe(4403);
    expect(await connectSetup(id, { cookie: bob }).closed).toBe(4403);
    expect(await connectSetup(randomUUID(), { cookie: alice }).closed).toBe(4403);
    expect(await connect('not-a-uuid', { cookie: alice, path: stPath('not-a-uuid') }).closed).toBe(4403);
    expectNoExec();
  });

  it('closes 4403 on a bad Origin', async () => {
    const id = await makeSetupTest('running');
    expect(await connectSetup(id, { cookie: alice, origin: 'http://evil.example' }).closed).toBe(4403);
    expectNoExec();
  });

  it('closes 4409 for an ended test, and for a queued one (not active yet)', async () => {
    const ended = await makeSetupTest('ended', { pod: false, ended: true });
    expect(await connectSetup(ended, { cookie: alice }).closed).toBe(4409);
    const queued = await makeSetupTest('queued', { pod: false });
    expect(await connectSetup(queued, { cookie: alice }).closed).toBe(4409);
    expectNoExec();
  });

  it('closes 4409 when the test is running but its pod is gone', async () => {
    const id = await makeSetupTest('running', { pod: false });
    expect(await connectSetup(id, { cookie: alice }).closed).toBe(4409);
    expectNoExec();
  });

  it('re-validates the session on a live setup-test socket: a revoked session closes 4401', async () => {
    const id = await makeSetupTest('running');
    const cookie = await loginAs(t, 'alice');
    const token = (
      (
        await t.db.pool.query(
          `select token from session where user_id = (select id from "user" where handle = 'alice') order by created_at desc limit 1`,
        )
      ).rows[0] as { token: string }
    ).token;
    const c = connectSetup(id, { cookie });
    await c.opened;
    await until(() => c.bytes().length > 0);
    await t.db.pool.query('delete from session where token = $1', [token]);
    expect(await c.closed).toBe(4401);
  });

  it('a run id and a setup-test id that are the same string do not share a connection entry or cap', async () => {
    const shared = await makeRun('running');
    await makeSetupTest('running', { id: shared });
    const open: Client[] = [];
    for (let i = 0; i < 4; i += 1) {
      const c = connect(shared, { cookie: alice });
      await c.opened;
      await until(() => c.bytes().length > 0);
      open.push(c);
    }
    // the run's four slots are taken; the setup test with the same id still gets its own
    const st = connectSetup(shared, { cookie: alice });
    await st.opened;
    await until(() => st.bytes().length > 0);
    open.push(st);
    expect(t.app.get(TerminalGateway).openCount()).toBe(5);
    expect(await connect(shared, { cookie: alice }).closed).toBe(1013);
    for (const c of open) {
      c.ws.close();
      await c.closed;
    }
  });
});
