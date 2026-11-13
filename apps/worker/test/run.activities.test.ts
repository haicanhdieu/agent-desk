import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { MockActivityEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeKubeGateway,
  FakeStore,
  FileSecretStore,
  MemorySecretStore,
  createAdapterRegistry,
  parseConfig,
  type Clock,
  type Config,
  type KubeGateway,
} from '@agentdesk/core';
import { createDb, runEvents, runs, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import type { FollowPodLogsResult, RunContext } from '../src/activities/run.activities';
import { createRunActivities, type RunActivityDeps, type RunSignaller } from '../src/activities/run.activities.impl';
import { reconcile, type ReconcileTemporal } from '../src/activities/reconcile.activity';

const ORG = '44444444-4444-4444-8444-444444444444';
const AGENT = '55555555-5555-4555-8555-555555555555';
const CRED = 'sk-ant-oat01-CREDENTIAL-VALUE-xyz';
let pgx: TestPg;
let db: Db;
let dir: string;
let projectId: string;
let kube: FakeKubeGateway;
let config: Config;
let store: FakeStore;
const secrets = new MemorySecretStore();
const signals: { runId: string; signal: string }[] = [];
const signaller: RunSignaller = {
  signalRun: async (runId, signal) => void signals.push({ runId, signal }),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(25);
  }
}

async function asOwner<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.org_id', $1, true)`, [ORG]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } finally {
    await c.end();
  }
}

async function seedRun(args: string, status = 'starting'): Promise<string> {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, agent_id, command, skill_name, ticket_ref, ticket_kind, ticket_number,
         checkout_ref, args, status, trigger_source)
       values ($1, $2, $3, 'fix', 'fix', '7', 'issue', 7, 'main', $4, $5, 'manual') returning id`,
      [ORG, projectId, AGENT, args, status],
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('seed failed');
    return id;
  });
}

function deps(over: Partial<RunActivityDeps> = {}): RunActivityDeps {
  return {
    db,
    kube,
    adapters: createAdapterRegistry(config, { now: () => new Date() }),
    secrets,
    signaller,
    clock: { now: () => new Date() },
    config,
    timing: { pollMs: 50, heartbeatMs: 200 },
    ...over,
  };
}

/** The shared fake gateway with some methods replaced. */
function wrapKube(over: Partial<KubeGateway>): KubeGateway {
  return {
    ensureSecret: (n, d, l) => kube.ensureSecret(n, d, l),
    readSecret: (n) => kube.readSecret(n),
    deleteSecret: (n) => kube.deleteSecret(n),
    ensureJob: (j) => kube.ensureJob(j),
    getRunPod: (n) => kube.getRunPod(n),
    streamLogs: (n, s) => kube.streamLogs(n, s),
    exec: (n, c, o) => kube.exec(n, c, o),
    deleteJob: (n) => kube.deleteJob(n),
    listRunJobs: () => kube.listRunJobs(),
    listRunSecrets: () => kube.listRunSecrets(),
    ...over,
  };
}

const ctxFor = async (runId: string): Promise<RunContext> => createRunActivities(deps()).loadRun(ORG, runId);

const load = (runId: string) =>
  withOrg(db, ORG, async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
    const events = await tx.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq);
    return { run, events };
  });

const statuses = async (runId: string): Promise<unknown[]> =>
  (await load(runId)).events.filter((e) => e.type === 'status').map((e) => e.payload.status);

/** Runs followPodLogs in an activity context, recording heartbeats. */
function follow(ctx: RunContext, d: RunActivityDeps, heartbeatDetails?: unknown) {
  const env = new MockActivityEnvironment(heartbeatDetails === undefined ? {} : { heartbeatDetails });
  const beats: unknown[] = [];
  env.on('heartbeat', (b: unknown) => beats.push(b));
  const acts = createRunActivities(d);
  const promise: Promise<FollowPodLogsResult> = env.run(acts.followPodLogs, ctx);
  promise.catch(() => undefined);
  return { env, beats, promise };
}

const lastLineOf = (b: unknown): number =>
  typeof b === 'object' && b !== null && 'lastLine' in b && typeof b.lastLine === 'number' ? b.lastLine : -1;

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  dir = await mkdtemp(join(tmpdir(), 'run-acts-'));
  kube = new FakeKubeGateway(join(dir, 'kube'), { turnMs: 150 });
  config = parseConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'http://localhost:5173',
    DATABASE_APP_URL: 'x',
    DATABASE_OWNER_URL: 'x',
    DATABASE_ADMIN_URL: 'x',
    TEMPORAL_ADDRESS: 'x',
    TEMPORAL_NAMESPACE: 'default',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    RUNNER_IMAGE: 'agentdesk/runner-claude:test',
    ENABLE_FAKE_PROVIDER: 'true',
    FAKE_STATE_DIR: join(dir, 'fake'),
  });
  store = new FakeStore(config.FAKE_STATE_DIR);
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  await c.query(`insert into organization (id, name, slug, created_at) values ($1, 'Acme', 'acme', now())`, [ORG]);
  await c.end();
  projectId = await asOwner(async (cl) => {
    const conn = await cl.query<{ id: string }>(
      `insert into connections (org_id, provider, capabilities, external_id, account_name)
       values ($1, 'fake', '{"code":true,"board":true}', $2, 'dev') returning id`,
      [ORG, `fake-${ORG}`],
    );
    const proj = await cl.query<{ id: string }>(
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id, max_concurrent_runs)
       values ($1, 'demo', 'dev/demo', $2, $2, 3) returning id`,
      [ORG, conn.rows[0]?.id],
    );
    const pid = proj.rows[0]?.id ?? '';
    await cl.query(
      `insert into agents (id, org_id, project_id, name, model, credential_secret_name, credential_type, max_turns,
         timeout_seconds)
       values ($1, $2, $3, 'claude', 'sonnet', $4, 'oauth_token', 25, 900)`,
      [AGENT, ORG, pid, `org-${ORG}-agent-${AGENT}`],
    );
    return pid;
  });
  await secrets.put(`org-${ORG}-agent-${AGENT}`, { type: 'oauth_token', value: CRED });
}, 180_000);

afterAll(async () => {
  await kube?.killAll();
  await db?.close();
  await pgx?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('loadRun', () => {
  it('returns the run context the workflow needs', async () => {
    const runId = await seedRun('x', 'queued');
    expect(await ctxFor(runId)).toEqual({
      orgId: ORG,
      runId,
      projectId,
      agentId: AGENT,
      status: 'queued',
      timeoutSeconds: 900,
      maxConcurrentRuns: 3,
      idleEndSeconds: 600,
    });
  });

  it('missing run → non-retryable', async () => {
    const err = await createRunActivities(deps())
      .loadRun(ORG, '99999999-9999-4999-8999-999999999999')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
  });
});

describe('createRunSecretAndJob', () => {
  it('creates Secret and Job run-{id} once, with the clone URL and the agent credential in the Secret', async () => {
    const runId = await seedRun('please fix');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await Promise.all([acts.createRunSecretAndJob(ctx), acts.createRunSecretAndJob(ctx)]);
    await acts.createRunSecretAndJob(ctx);
    const name = `run-${runId}`;
    expect(await kube.readSecret(name)).toEqual({
      REPO_CLONE_URL: 'https://fake.invalid/dev/demo.git',
      GH_TOKEN: 'fake-workspace-token',
      CLAUDE_CODE_OAUTH_TOKEN: CRED,
    });
    expect((await kube.processIds()).filter((p) => p.jobName === name)).toHaveLength(1);
    const env = await kube.podEnv(name);
    expect(env?.PROMPT).toContain('Arguments from the user: please fix');
    expect(env?.PROMPT).toContain('Use the skill "fix" on issue #7 in dev/demo.');
    expect(env).toMatchObject({ CHECKOUT_REF: 'main', MAX_TURNS: '25', CLAUDE_CODE_OAUTH_TOKEN: CRED });
    expect(env?.PLUGIN_MARKETPLACES).toBe(JSON.stringify(config.RUN_PLUGIN_MARKETPLACES));
    expect(env?.SETUP_TIMEOUT_SECONDS).toBe(String(config.RUN_SETUP_TIMEOUT_SECONDS));
    expect((await load(runId)).run?.jobName).toBe(name);
    // Nothing about the Secret's values lands in the database.
    expect(JSON.stringify(await load(runId))).not.toContain(CRED);
    await acts.deleteJob(ctx);
    expect(await kube.readSecret(name)).toBeNull();
    expect(await kube.getRunPod(name)).toBeNull();
  });

  it('a missing credential fails non-retryably without creating anything', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const empty = new MemorySecretStore();
    const err = await createRunActivities(deps({ secrets: empty }))
      .createRunSecretAndJob(ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect(await kube.getRunPod(`run-${runId}`)).toBeNull();
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
  });

  it('adapter errors carry no secret values', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const failing = wrapKube({
      ensureSecret: async () => {
        throw new Error(`422 invalid secret ${CRED} https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz@h/r.git`);
      },
    });
    const err = await createRunActivities(deps({ kube: failing }))
      .createRunSecretAndJob(ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    const msg = (err as Error).message;
    expect(msg).not.toContain(CRED);
    expect(msg).not.toContain('ghs_abcdefghijklmnopqrstuvwxyz');
    expect(msg).toContain('422');
  });
});

describe('createRunSecretAndJob cleanup', () => {
  it('deletes the Secret again when creating the Job fails', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const failing = wrapKube({
      ensureJob: async () => {
        throw new Error('500 etcd unavailable');
      },
    });
    const err = await createRunActivities(deps({ kube: failing }))
      .createRunSecretAndJob(ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(false);
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
  });
});

describe('redaction fails closed', () => {
  it('a transient readSecret error fails followPodLogs retryably and persists nothing', async () => {
    const runId = await seedRun(`echo ${CRED}`);
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    await until(async () => (await kube.getRunPod(`run-${runId}`))?.phase === 'Running');
    const broken = wrapKube({
      readSecret: async () => {
        throw new Error('connect ETIMEDOUT');
      },
    });
    const err = await follow(ctx, deps({ kube: broken })).promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(false);
    const { run, events } = await load(runId);
    expect(run?.status).toBe('starting');
    expect(events).toEqual([]);
    await acts.deleteJob(ctx);
  });

  it('a credential store error fails postComment retryably and posts nothing', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const before = (await store.listPosted()).length;
    const broken = new MemorySecretStore();
    broken.get = async () => {
      throw new Error('store unavailable');
    };
    const err = await createRunActivities(deps({ secrets: broken }))
      .postComment(ctx, 'finish', { status: 'failed', scrollbackTail: CRED })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((await store.listPosted()).length).toBe(before);
  });
});

describe('activity errors are redacted', () => {
  // A store whose read error quotes the stored value (like a JSON SyntaxError over a corrupt file).
  const LEAK = 'stored-credential-value-0123456789abcdef';
  const leaky = (): MemorySecretStore => {
    const s = new MemorySecretStore();
    s.get = async () => {
      throw new SyntaxError(
        `Unexpected end of JSON input: {"type":"api_key","value":"${LEAK} sk-ant-api03-abcdefghijklmn`,
      );
    };
    return s;
  };
  const check = (err: unknown): void => {
    expect(err).toBeInstanceOf(ApplicationFailure);
    const e = err as ApplicationFailure;
    expect(e.message).not.toContain(LEAK.slice(0, 16));
    expect(e.message).not.toContain('sk-ant-api03');
    expect(e.cause).toBeUndefined();
    expect(e.message.length).toBeLessThan(400);
  };

  it('a store read error in createRunSecretAndJob and postComment reaches Temporal only as a fixed or redacted message', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps({ secrets: leaky() }));
    check(await acts.createRunSecretAndJob(ctx).catch((e: unknown) => e));
    check(await acts.postComment(ctx, 'finish', { status: 'failed' }).catch((e: unknown) => e));
    const followErr = await follow(ctx, deps({ secrets: leaky() })).promise.catch((e: unknown) => e);
    check(followErr);
  });

  it('a corrupt credential file in the file store leaks nothing into the activity error', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const fileDir = join(dir, 'corrupt-secrets');
    await mkdir(fileDir, { recursive: true });
    await writeFile(join(fileDir, `org-${ORG}-agent-${AGENT}.json`), `{"type":"api_key","value":"${LEAK}`);
    const err = await createRunActivities(deps({ secrets: new FileSecretStore(fileDir) }))
      .createRunSecretAndJob(ctx)
      .catch((e: unknown) => e);
    check(err);
    expect((err as Error).message).toContain('credential store read failed');
  });
});

describe('followPodLogs', () => {
  it('writes running then idle, signals turnFinished, stores one redacted scrollback, returns the exit code', async () => {
    const runId = await seedRun(`echo ${CRED} please`);
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    const f = follow(ctx, deps());
    await until(async () => (await load(runId)).run?.status === 'idle');
    await until(async () => signals.some((s) => s.runId === runId && s.signal === 'turnFinished'));
    await acts.endSession(ctx);
    const result = await f.promise;
    expect(result.exitCode).toBe(0);
    expect(result.scrollbackTail).toContain('***');
    expect(result.scrollbackTail).not.toContain(CRED);

    const { events } = await load(runId);
    expect(await statuses(runId)).toEqual(['running', 'idle']);
    const lifecycle = events.filter((e) => e.type === 'lifecycle').map((e) => e.payload.kind);
    expect(lifecycle).toEqual(['checkout', 'plugins_begin', 'plugins_end', 'session_started', 'turn_finished']);
    const scrollback = events.filter((e) => e.type === 'scrollback');
    expect(scrollback).toHaveLength(1);
    const text = String(scrollback[0]?.payload.text);
    expect(text).toContain('Fake Claude Code');
    expect(text).toContain('***');
    expect(JSON.stringify(events)).not.toContain(CRED);
    expect(f.beats.length).toBeGreaterThan(0);
    await acts.ensureJobGone(ctx);
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
    expect((await kube.getRunPod(`run-${runId}`))?.phase).toBe('Succeeded'); // a finished Job is kept (TTL)
    await acts.deleteJob(ctx);
  });

  it('Review Focus 3: resumed after cancel at {lastLine: 5}, no duplicate rows and no running after idle', async () => {
    const runId = await seedRun('resume me');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);

    const first = follow(ctx, deps());
    await until(async () => first.beats.some((b) => lastLineOf(b) >= 5));
    first.env.cancel();
    await expect(first.promise).rejects.toBeInstanceOf(CancelledFailure);
    expect((await load(runId)).run?.status).toBe('idle');

    // The worker restarted: the retry gets the last heartbeat's details.
    const second = follow(ctx, deps(), { lastLine: 5 });
    await sleep(300);
    // Another turn (the user typed in the terminal).
    const attach = await kube.exec(`run-${runId}`, ['tmux', 'attach', '-t', 'agent'], { tty: true });
    attach.write(new TextEncoder().encode('again\r'));
    await until(
      async () => (await load(runId)).events.filter((e) => e.type === 'lifecycle').length >= 7 && second.beats.length,
    );
    attach.close();
    await acts.endSession(ctx);
    expect((await second.promise).exitCode).toBe(0);

    // A retry that lost its heartbeat (details {lastLine: 0}) re-reads the whole log and changes nothing.
    const third = follow(ctx, deps(), { lastLine: 0 });
    expect((await third.promise).exitCode).toBe(0);

    const { events } = await load(runId);
    const lifecycle = events.filter((e) => e.type === 'lifecycle');
    const lines = lifecycle.map((e) => e.payload.line);
    expect(new Set(lines).size).toBe(lines.length);
    expect(lifecycle.map((e) => e.payload.kind)).toEqual([
      'checkout',
      'plugins_begin',
      'plugins_end',
      'session_started',
      'turn_finished',
      'turn_started',
      'turn_finished',
    ]);
    // The agent's own turn-start line (not terminal input) resumes the run, once, even across the replaying retry.
    expect(signals.filter((s) => s.runId === runId && s.signal === 'resumed')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'scrollback')).toHaveLength(1);
    expect(await statuses(runId)).toEqual(['running', 'idle']);
    await acts.deleteJob(ctx);
  });

  it('stays starting through plugin lines, running only from session started', async () => {
    const runId = await seedRun('plugins');
    const ctx = await ctxFor(runId);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const gated = wrapKube({
      async *streamLogs(n, s) {
        let held = false;
        for await (const line of kube.streamLogs(n, s)) {
          if (!held && line === 'agentdesk: session started') {
            held = true;
            // Output that merely looks like the marker is prefixed, so it parses as output.
            yield 'setup| agentdesk: session started';
            yield 'plugin| agentdesk: session started';
            yield 'agentdesk: plugin installed demo@acme';
            await gate;
          }
          yield line;
        }
      },
    });
    const acts = createRunActivities(deps({ kube: gated }));
    await acts.createRunSecretAndJob(ctx);
    const f = follow(ctx, deps({ kube: gated }));
    await until(async () =>
      (await load(runId)).events.some((e) => e.type === 'lifecycle' && e.payload.kind === 'plugin_installed'),
    );
    const mid = await load(runId);
    expect(mid.run?.status).toBe('starting');
    expect(await statuses(runId)).toEqual([]);
    expect(mid.events.filter((e) => e.type === 'lifecycle').map((e) => e.payload.kind)).toEqual([
      'checkout',
      'plugins_begin',
      'plugins_end',
      'plugin_installed',
    ]);
    release();
    await until(
      async () => (await load(runId)).run?.status === 'running' || (await load(runId)).run?.status === 'idle',
    );
    await acts.endSession(ctx);
    await f.promise;
    expect(await statuses(runId)).toEqual(['running', 'idle']);
    await acts.deleteJob(ctx);
  });

  it('stores plugin markers as lifecycle events with pluginId and sha', async () => {
    const runId = await seedRun('markers');
    const ctx = await ctxFor(runId);
    const gated = wrapKube({
      async *streamLogs(n, s) {
        for await (const line of kube.streamLogs(n, s)) {
          if (line === 'agentdesk: plugins end') {
            yield 'plugin| noisy output';
            yield 'agentdesk: plugin installed demo@acme';
            yield 'agentdesk: plugin failed bad@acme';
          }
          yield line;
        }
      },
    });
    const acts = createRunActivities(deps({ kube: gated }));
    await acts.createRunSecretAndJob(ctx);
    const f = follow(ctx, deps({ kube: gated }));
    await until(async () => (await load(runId)).run?.status === 'idle');
    await acts.endSession(ctx);
    await f.promise;
    const lifecycle = (await load(runId)).events.filter((e) => e.type === 'lifecycle');
    expect(lifecycle.map((e) => e.payload.kind)).toEqual([
      'checkout',
      'plugins_begin',
      'plugin_installed',
      'plugin_failed',
      'plugins_end',
      'session_started',
      'turn_finished',
    ]);
    expect(lifecycle[0]?.payload.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(lifecycle[2]?.payload).toMatchObject({
      kind: 'plugin_installed',
      pluginId: 'demo@acme',
      text: 'agentdesk: plugin installed demo@acme',
    });
    expect(lifecycle[3]?.payload.pluginId).toBe('bad@acme');
    expect(JSON.stringify(lifecycle)).not.toContain('noisy output');
    await acts.deleteJob(ctx);
  });

  it('does not write running when the run is no longer starting', async () => {
    const runId = await seedRun('x', 'idle');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    const f = follow(ctx, deps());
    await until(async () => (await load(runId)).events.some((e) => e.type === 'lifecycle'));
    await acts.endSession(ctx);
    await f.promise;
    expect(await statuses(runId)).toEqual([]);
    await acts.deleteJob(ctx);
  });

  it('--fake-fail → exit code 3 with the scrollback tail', async () => {
    const runId = await seedRun('--fake-fail');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    const r = await follow(ctx, deps()).promise;
    expect(r.exitCode).toBe(3);
    expect(r.scrollbackTail).toContain('--fake-fail');
    await acts.deleteJob(ctx);
  });

  it('a multi-MB scrollback is stored in linear time, capped to the newest 1 MB, closed at the last end marker', async () => {
    const runId = await seedRun('big');
    const ctx = await ctxFor(runId);
    const LINES = 300_000; // ~10 MB of scrollback
    const pad = 'x'.repeat(24);
    const big = wrapKube({
      readSecret: async () => ({ REPO_CLONE_URL: 'https://fake.invalid/dev/demo.git' }),
      getRunPod: async (name) => ({ name, phase: 'Succeeded', pendingSince: null, reason: null, exitCode: 0 }),
      streamLogs: async function* () {
        yield 'agentdesk: session started';
        yield 'agentdesk: final scrollback begin';
        for (let i = 0; i < LINES; i += 1) yield `line ${String(i).padStart(7, '0')} ${pad}`;
        yield 'agentdesk: final scrollback end';
      },
    });
    const started = Date.now();
    const r = await follow(ctx, deps({ kube: big })).promise;
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5000);
    expect(r.exitCode).toBe(0);
    const rows = (await load(runId)).events.filter((e) => e.type === 'scrollback');
    expect(rows).toHaveLength(1);
    const text = String(rows[0]?.payload.text);
    expect(text.length).toBeLessThanOrEqual(1_000_000);
    expect(text.length).toBeGreaterThan(900_000);
    expect(rows[0]?.payload.truncated).toBe(true);
    expect(text.endsWith(`line ${String(LINES - 1).padStart(7, '0')} ${pad}`)).toBe(true);
    expect(text).not.toContain('scrollback end');
    expect(r.scrollbackTail?.length).toBe(4000);
    expect(r.scrollbackTail && text.endsWith(r.scrollbackTail)).toBe(true);
  });

  it('a log stream that drops mid-scrollback re-reads the block instead of storing a partial one', async () => {
    const runId = await seedRun('drop');
    const ctx = await ctxFor(runId);
    let pass = 0;
    const lines = ['agentdesk: session started', 'agentdesk: final scrollback begin', 'a', 'b'];
    const dropping = wrapKube({
      readSecret: async () => null,
      getRunPod: async (name) =>
        pass < 2
          ? { name, phase: 'Running', pendingSince: null, reason: null, exitCode: null }
          : { name, phase: 'Succeeded', pendingSince: null, reason: null, exitCode: 0 },
      streamLogs: async function* () {
        pass += 1;
        yield* lines; // first pass drops before the end marker
        if (pass >= 2) yield* ['c', 'agentdesk: final scrollback end'];
      },
    });
    // A clock that jumps past the exit wait so the first pass sees "still running" quickly.
    let t = Date.now();
    const clock: Clock = { now: () => new Date((t += 30_000)) };
    const r = await follow(ctx, deps({ kube: dropping, clock })).promise;
    expect(r.exitCode).toBe(0);
    const rows = (await load(runId)).events.filter((e) => e.type === 'scrollback');
    expect(rows.map((e) => e.payload.text)).toEqual(['a\nb\nc']);
  });

  it('Pending for over 2 min (fake clock) → non-retryable PodPendingTimeout with the pod reason', async () => {
    const runId = await seedRun('--fake-pending');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    let calls = 0;
    // First reads are "now"; then the clock jumps 2 min + 1 s past the pod's creation.
    const clock: Clock = { now: () => new Date(Date.now() + (++calls > 3 ? 121_000 : 0)) };
    const err = await follow(ctx, deps({ clock })).promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    const f = err as ApplicationFailure;
    expect(f.type).toBe('PodPendingTimeout');
    expect(f.nonRetryable).toBe(true);
    expect(f.message).toContain('fake pod has not started');
    expect(calls).toBeGreaterThan(3);
    await acts.deleteJob(ctx);
  });
});

describe('postComment', () => {
  it('start and finish are posted once each (outbox) with the run link, status, exit code, reason and a redacted tail', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    const before = (await store.listPosted()).length;
    await acts.postComment(ctx, 'start');
    await acts.postComment(ctx, 'start');
    const details = {
      status: 'failed' as const,
      exitCode: 2,
      failureReason: 'agent exited with code 2',
      scrollbackTail: `line1\n${CRED}\n\`\`\`\nlast line`,
    };
    await acts.postComment(ctx, 'finish', details);
    await acts.postComment(ctx, 'finish', details);
    const posted = (await store.listPosted()).slice(before);
    expect(posted).toHaveLength(2);
    const [start, finish] = posted;
    const number = (await load(runId)).run?.number;
    expect(start?.ticketRef).toBe('7');
    expect(start?.body).toContain(`run #${number}`);
    expect(start?.body).toContain(`http://localhost:5173/o/acme/p/${projectId}/runs/${number}`);
    expect(finish?.body).toContain('failed');
    expect(finish?.body).toContain('Exit code: 2');
    expect(finish?.body).toContain('agent exited with code 2');
    expect(finish?.body).toContain('last line');
    expect(finish?.body).not.toContain(CRED);
    expect(finish?.body.split('\n')[0]?.startsWith('/')).toBe(false);
    const { run, events } = await load(runId);
    expect(Object.keys(run?.outbox ?? {}).sort()).toEqual(['finish', 'start']);
    expect(events.filter((e) => e.type === 'comment').map((e) => e.payload.kind)).toEqual(['start', 'finish']);
  });
});

describe('reconcile', () => {
  it('deletes Jobs whose run is final, missing or whose workflow is closed; releases leaked gate slots', async () => {
    const acts = createRunActivities(deps());
    const finalRun = await seedRun('x', 'running');
    const liveRun = await seedRun('x', 'running');
    const closedRun = await seedRun('x', 'running');
    for (const id of [finalRun, liveRun, closedRun]) await acts.createRunSecretAndJob(await ctxFor(id));
    await asOwner((c) => c.query(`update runs set status = 'succeeded' where id = $1`, [finalRun]));
    // A Job labelled with an org that has no such run.
    await kube.ensureJob({
      metadata: {
        name: 'run-66666666-6666-4666-8666-666666666666',
        labels: {
          'agentdesk/run-id': '66666666-6666-4666-8666-666666666666',
          'agentdesk/org-id': '77777777-7777-4777-8777-777777777777',
          'agentdesk/project-id': projectId,
        },
      },
      spec: {
        template: { spec: { containers: [{ name: 'agent', env: [{ name: 'PROMPT', value: '--fake-pending' }] }] } },
      },
    });

    const released: { projectId: string; runId: string }[] = [];
    const temporal: ReconcileTemporal = {
      isWorkflowOpen: async (id) => id === `run-${liveRun}`,
      listOpenGateProjectIds: async () => [projectId],
      gateRuns: async () => [liveRun, closedRun],
      releaseSlot: async (p, r) => void released.push({ projectId: p, runId: r }),
    };
    const out = await reconcile({ db, kube, temporal });
    const left = (await kube.listRunJobs()).map((j) => j.runId);
    expect(left).toContain(liveRun);
    expect(left).not.toContain(finalRun);
    expect(left).not.toContain(closedRun);
    expect(left).not.toContain('66666666-6666-4666-8666-666666666666');
    expect(await kube.readSecret(`run-${finalRun}`)).toBeNull();
    expect(released).toEqual([{ projectId, runId: closedRun }]);
    expect(out).toEqual({ deletedJobs: 3, deletedSecrets: 0, releasedSlots: 1 });
    await acts.deleteJob(await ctxFor(liveRun));
  });
});

describe('reconcile: run Secrets without a Job', () => {
  it('deletes Secrets of final runs, closed workflows and Job-less live runs; keeps an in-flight create', async () => {
    const labels = (runId: string) => ({
      'agentdesk/run-id': runId,
      'agentdesk/org-id': ORG,
      'agentdesk/project-id': projectId,
    });
    const finalRun = await seedRun('x', 'failed');
    const closedRun = await seedRun('x', 'idle');
    const jobGoneRun = await seedRun('x', 'running');
    const creatingRun = await seedRun('x', 'starting');
    for (const id of [finalRun, closedRun, jobGoneRun, creatingRun]) {
      await kube.ensureSecret(`run-${id}`, { REPO_CLONE_URL: 'https://t@x.invalid/r.git' }, labels(id));
    }
    const open = new Set([`run-${jobGoneRun}`, `run-${creatingRun}`]);
    const out = await reconcile({
      db,
      kube,
      temporal: {
        isWorkflowOpen: async (id) => open.has(id),
        listOpenGateProjectIds: async () => [],
        gateRuns: async () => [],
        releaseSlot: async () => undefined,
      },
    });
    expect(out).toEqual({ deletedJobs: 0, deletedSecrets: 3, releasedSlots: 0 });
    for (const id of [finalRun, closedRun, jobGoneRun]) expect(await kube.readSecret(`run-${id}`)).toBeNull();
    expect(await kube.readSecret(`run-${creatingRun}`)).not.toBeNull();
    await kube.deleteSecret(`run-${creatingRun}`);
  });
});

describe('no leaked fake pods', () => {
  it('every process this suite started is gone after deleteJob/ensureJobGone', async () => {
    await kube.killAll();
    const alive = (await kube.processIds()).filter(({ pid }) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    expect(alive).toEqual([]);
  });
});
