import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { MockActivityEnvironment } from '@temporalio/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  type RunPod,
} from '@agentdesk/core';
import { createDb, runEvents, runs, runTranscriptEntries, setupScriptVersions, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import type { FollowPodLogsResult, RunContext } from '../src/activities/run.activities';
import { createRunActivities, type RunActivityDeps, type RunSignaller } from '../src/activities/run.activities.impl';
import { appendRunEvent } from '../src/activities/run-events';
import { setRunStatus } from '../src/activities/run-status.activity';
import { reconcile, type ReconcileTemporal } from '../src/activities/reconcile.activity';

const ORG = '44444444-4444-4444-8444-444444444444';
const SETUP_LIMITS = { setupTimeoutSeconds: 600 };
// Volumes of earlier tests' runs may still be in the shared fake cluster, so their count is not pinned here
// (reconcile.int.test.ts pins volume behaviour).
const NO_SETUP_TEST_DELETES = {
  deletedSetupTestJobs: 0,
  deletedSetupTestSecrets: 0,
  deletedVolumes: expect.any(Number) as number,
  expiredRuns: 0,
};
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
const signals: { runId: string; signal: string; arg?: string }[] = [];
const signaller: RunSignaller = {
  signalRun: async (runId, signal, arg) => void signals.push({ runId, signal, ...(arg !== undefined ? { arg } : {}) }),
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

async function seedPromptRun(prompt: string, args: string, ruleId: string | null = null): Promise<string> {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, agent_id, command, skill_name, prompt, rule_id, ticket_ref, ticket_kind,
         ticket_number, checkout_ref, args, status, trigger_source)
       values ($1, $2, $3, 'fix', null, $4, $6, '7', 'issue', 7, 'main', $5, 'starting', 'manual') returning id`,
      [ORG, projectId, AGENT, prompt, args, ruleId],
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
    replaceSecretData: (n, d) => kube.replaceSecretData(n, d),
    readSecret: (n) => kube.readSecret(n),
    deleteSecret: (n) => kube.deleteSecret(n),
    ensureJob: (j) => kube.ensureJob(j),
    getRunPod: (n) => kube.getRunPod(n),
    streamLogs: (n, s) => kube.streamLogs(n, s),
    exec: (n, c, o) => kube.exec(n, c, o),
    deleteJob: (n) => kube.deleteJob(n),
    listRunJobs: () => kube.listRunJobs(),
    listSetupTestJobs: () => kube.listSetupTestJobs(),
    listRunSecrets: () => kube.listRunSecrets(),
    listSetupTestSecrets: () => kube.listSetupTestSecrets(),
    ensureVolumeClaim: (n, s, l) => kube.ensureVolumeClaim(n, s, l),
    deleteVolumeClaim: (n) => kube.deleteVolumeClaim(n),
    listRunVolumeClaims: () => kube.listRunVolumeClaims(),
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
function follow(ctx: RunContext, d: RunActivityDeps, heartbeatDetails?: unknown, opts?: { resume?: boolean }) {
  const env = new MockActivityEnvironment(heartbeatDetails === undefined ? {} : { heartbeatDetails });
  const beats: unknown[] = [];
  env.on('heartbeat', (b: unknown) => beats.push(b));
  const acts = createRunActivities(d);
  const promise: Promise<FollowPodLogsResult> = env.run(acts.followPodLogs, ctx, opts);
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
      idleEndSeconds: 1800,
      endingDeadlineSeconds: 90,
      leaseTtlSeconds: 300,
    });
  });

  it('takes the attach lease time from config (RUN_LEASE_TTL_SECONDS), so a test can expire leases quickly', async () => {
    const runId = await seedRun('x', 'queued');
    const quick = await createRunActivities(deps({ config: { ...config, RUN_LEASE_TTL_SECONDS: 4 } })).loadRun(
      ORG,
      runId,
    );
    expect(quick.leaseTtlSeconds).toBe(4);
  });

  it('takes the idle end from config (RUN_IDLE_END_SECONDS), so the local stack can pause quickly', async () => {
    const runId = await seedRun('x', 'queued');
    const quick = await createRunActivities(deps({ config: { ...config, RUN_IDLE_END_SECONDS: 7 } })).loadRun(
      ORG,
      runId,
    );
    expect(quick.idleEndSeconds).toBe(7);
  });

  describe('idle end per agent', () => {
    const setIdle = (seconds: number) =>
      asOwner((c) => c.query(`update agents set idle_end_seconds = $1 where id = $2`, [seconds, AGENT]));
    afterEach(() => setIdle(1800));

    it('takes the idle end from the run agent (agents.idle_end_seconds), not a fixed value', async () => {
      await setIdle(900);
      const runId = await seedRun('x', 'queued');
      expect((await ctxFor(runId)).idleEndSeconds).toBe(900);
    });

    it('RUN_IDLE_END_SECONDS, when set away from its default, still wins so the local stack can pause quickly', async () => {
      await setIdle(900);
      const runId = await seedRun('x', 'queued');
      const quick = await createRunActivities(deps({ config: { ...config, RUN_IDLE_END_SECONDS: 7 } })).loadRun(
        ORG,
        runId,
      );
      expect(quick.idleEndSeconds).toBe(7);
    });

    it('an agent deleted after queueing falls back to the 30 minute default', async () => {
      const runId = await seedRun('x', 'queued');
      await asOwner((c) => c.query(`update runs set agent_id = null where id = $1`, [runId]));
      expect((await ctxFor(runId)).idleEndSeconds).toBe(1800);
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

describe('recordEndingDeadline', () => {
  const NOT_SAVED = 'The session did not end in time; the pod was stopped. Final scrollback not saved.';
  const SAVED = 'The session did not end in time; the pod was stopped.';
  const AT = '2026-01-01T00:01:00.000Z';

  it('appends one lifecycle event per call, mentioning scrollback only when it was not saved', async () => {
    for (const [scrollbackSaved, text] of [
      [false, NOT_SAVED],
      [true, SAVED],
    ] as const) {
      const runId = await seedRun('x', 'running');
      await createRunActivities(deps()).recordEndingDeadline(await ctxFor(runId), { scrollbackSaved, at: AT });
      const events = (await load(runId)).events.filter((e) => e.type === 'lifecycle');
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({ kind: 'ending_deadline', text });
      expect(events[0]?.ts.toISOString()).toBe(AT);
    }
  });

  it('an invalid timestamp and an unknown run fail non-retryably', async () => {
    const runId = await seedRun('x', 'running');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    const bad = await acts.recordEndingDeadline(ctx, { scrollbackSaved: true, at: 'nope' }).catch((e: unknown) => e);
    const gone = await acts
      .recordEndingDeadline(
        { ...ctx, runId: '99999999-9999-4999-8999-999999999999' },
        { scrollbackSaved: true, at: AT },
      )
      .catch((e: unknown) => e);
    for (const err of [bad, gone]) {
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
    expect((await load(runId)).events.filter((e) => e.type === 'lifecycle')).toHaveLength(0);
  });
});

/** Adapters whose workspace token changes on every mint, to prove a refresh rotates it. */
function rotatingAdapters(ttlMs = 0): { adapters: RunActivityDeps['adapters']; mints: () => number } {
  const base = createAdapterRegistry(config, { now: () => new Date() });
  let n = 0;
  return {
    mints: () => n,
    adapters: {
      ...base,
      codeHost: (provider) =>
        Object.assign(Object.create(base.codeHost(provider)) as object, {
          mintWorkspaceToken: async () => ({
            token: `ghs_rotated${++n}ABCDEFGHIJKLMNOPQRST`,
            expiresAt: new Date(Date.now() + ttlMs),
          }),
        }) as unknown as ReturnType<RunActivityDeps['adapters']['codeHost']>,
    },
  };
}

describe('run volume', () => {
  it('createRunSecretAndJob makes the per-run claim before the Job, and the Job mounts it', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps({ adapters: rotatingAdapters().adapters }));
    await acts.createRunSecretAndJob(ctx);
    const claims = await kube.listRunVolumeClaims();
    expect(claims).toContainEqual({ name: `run-${runId}`, runId, orgId: ORG, projectId });
    const jobs = await kube.listRunJobs();
    expect(jobs.some((j) => j.runId === runId)).toBe(true);
    await acts.deleteJob(ctx);
    await acts.deleteRunVolume(ctx);
  });

  it('deleteJob keeps the claim; deleteRunVolume removes it, twice is fine', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps({ adapters: rotatingAdapters().adapters }));
    await acts.createRunSecretAndJob(ctx);
    await acts.deleteJob(ctx);
    expect((await kube.listRunVolumeClaims()).some((c) => c.runId === runId)).toBe(true);
    await acts.deleteRunVolume(ctx);
    await acts.deleteRunVolume(ctx);
    expect((await kube.listRunVolumeClaims()).some((c) => c.runId === runId)).toBe(false);
  });
});

describe('refreshWorkspaceToken', () => {
  it('reports the next refresh as about 75% of the token life left, for the mint and for each refresh', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const { adapters } = rotatingAdapters(3_600_000);
    const acts = createRunActivities(deps({ adapters }));
    const created = await acts.createRunSecretAndJob(ctx);
    const refreshed = await acts.refreshWorkspaceToken(ctx);
    for (const plan of [created, refreshed]) {
      expect(plan?.nextRefreshSeconds).toBeGreaterThanOrEqual(2690);
      expect(plan?.nextRefreshSeconds).toBeLessThanOrEqual(2700);
      expect(JSON.stringify(plan)).not.toContain('ghs_rotated');
    }
    await acts.deleteJob(ctx);
  });

  it('mints a new token into the existing run Secret and leaves the rest and the pod env alone', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const { adapters, mints } = rotatingAdapters();
    const acts = createRunActivities(deps({ adapters }));
    await acts.createRunSecretAndJob(ctx);
    const name = `run-${runId}`;
    const before = await kube.readSecret(name);
    expect(before?.['workspace-token']).toBe('ghs_rotated1ABCDEFGHIJKLMNOPQRST');
    const envBefore = JSON.stringify(await kube.podEnv(name));
    await acts.refreshWorkspaceToken(ctx);
    expect(mints()).toBe(2);
    expect(await kube.readSecret(name)).toEqual({ ...before, 'workspace-token': 'ghs_rotated2ABCDEFGHIJKLMNOPQRST' });
    expect(JSON.stringify(await kube.podEnv(name))).toBe(envBefore);
    await acts.deleteJob(ctx);
  });

  it('does nothing for a finished run and never creates a Secret', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const { adapters, mints } = rotatingAdapters();
    await withOrg(db, ORG, (tx) => tx.update(runs).set({ status: 'succeeded' }).where(eq(runs.id, runId)));
    await createRunActivities(deps({ adapters })).refreshWorkspaceToken(ctx);
    expect(mints()).toBe(0);
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
  });

  it('fails non-retryably, without a token in the message, when the run Secret is gone', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const { adapters } = rotatingAdapters();
    const err = await createRunActivities(deps({ adapters }))
      .refreshWorkspaceToken(ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).message).not.toContain('ghs_rotated');
  });
});

describe('createRunSecretAndJob', () => {
  const authorEnvOf = async (triggeredBy: string | null, externalId: string | null) => {
    const runId = await seedRun('x');
    await asOwner((c) =>
      c.query('update runs set triggered_by = $1, triggered_by_external_id = $2 where id = $3', [
        triggeredBy,
        externalId,
        runId,
      ]),
    );
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(await ctxFor(runId));
    const env = await kube.podEnv(`run-${runId}`);
    await acts.deleteJob(await ctxFor(runId));
    return env;
  };

  it('credits the trigger person as author and authorizer in the Job env, and keeps the bot for the trailer', async () => {
    const env = await authorEnvOf('alice', '42');
    expect(env).toMatchObject({
      RUN_AUTHOR_NAME: 'alice',
      RUN_AUTHOR_EMAIL: 'alice@users.noreply.fake.invalid',
      RUN_AUTHORIZED_BY: 'alice',
      BOT_NAME: config.BOT_NAME,
      BOT_EMAIL: config.BOT_EMAIL,
    });
  });

  it('keeps the bot as author and authorizer for an older run with no trigger person', async () => {
    const env = await authorEnvOf(null, null);
    expect(env).toMatchObject({
      RUN_AUTHOR_NAME: config.BOT_NAME,
      RUN_AUTHOR_EMAIL: config.BOT_EMAIL,
      RUN_AUTHORIZED_BY: config.BOT_NAME,
    });
  });

  it('creates Secret and Job run-{id} once, with the clone URL and the agent credential in the Secret', async () => {
    const runId = await seedRun('please fix');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await Promise.all([acts.createRunSecretAndJob(ctx), acts.createRunSecretAndJob(ctx)]);
    await acts.createRunSecretAndJob(ctx);
    const name = `run-${runId}`;
    expect(await kube.readSecret(name)).toEqual({
      REPO_CLONE_URL: 'https://fake.invalid/dev/demo.git',
      'workspace-token': 'fake-workspace-token',
      CLAUDE_CODE_OAUTH_TOKEN: CRED,
    });
    expect((await kube.processIds()).filter((p) => p.jobName === name)).toHaveLength(1);
    const env = await kube.podEnv(name);
    expect(env?.PROMPT).toContain('Arguments from the user: please fix');
    expect(env?.PROMPT).toContain('Use the skill "fix" on issue #7 in dev/demo.');
    expect(env).toMatchObject({ CHECKOUT_REF: 'main', MAX_TURNS: '25', CLAUDE_CODE_OAUTH_TOKEN: CRED });
    expect(env?.PLUGIN_MARKETPLACES).toBe(JSON.stringify(config.RUN_PLUGIN_MARKETPLACES));
    expect(env?.SETUP_TIMEOUT_SECONDS).toBe(String(config.RUN_SETUP_TIMEOUT_SECONDS));
    // The workspace token is a mounted file, never an env var, and the repo URL carries no credential.
    expect(JSON.stringify(env)).not.toContain('fake-workspace-token');
    expect(env).toMatchObject({
      REPO_CLONE_URL: 'https://fake.invalid/dev/demo.git',
      AGENTDESK_TOKEN_FILE: '/var/run/agentdesk/workspace-token/token',
      AGENTDESK_GIT_USERNAME: 'x-access-token',
      AGENTDESK_GIT_HOST: 'fake.invalid',
      AGENTDESK_CLI_TOKEN_ENV: 'GH_TOKEN',
    });
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

describe('createRunSecretAndJob prompt', () => {
  it('a prompt run gets the custom prompt then the system lines in PROMPT', async () => {
    const runId = await seedPromptRun('Triage this.\nAdd labels.', 'now');
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(await ctxFor(runId));
    const prompt = (await kube.podEnv(`run-${runId}`))?.PROMPT ?? '';
    expect(prompt.startsWith('Triage this.\nAdd labels.')).toBe(true);
    expect(prompt).toContain('Ticket: issue #7 in dev/demo.');
    expect(prompt).not.toContain('Use the skill');
    await acts.deleteJob(await ctxFor(runId));
  });

  it('stores the final prompt once, redacted with the run secrets', async () => {
    const runId = await seedPromptRun(`use ${CRED} now`, 'x');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    await acts.createRunSecretAndJob(ctx);
    const { run } = await load(runId);
    expect(run?.finalPrompt).toContain('use *** now');
    expect(run?.finalPrompt).not.toContain(CRED);
    expect((await kube.podEnv(`run-${runId}`))?.PROMPT).toContain(CRED);
    await asOwner((c) => c.query(`update runs set final_prompt = 'first' where id = $1`, [runId]));
    await acts.createRunSecretAndJob(ctx);
    expect((await load(runId)).run?.finalPrompt).toBe('first');
    await acts.deleteJob(ctx);
  });

  it('a skill run records its five-line prompt', async () => {
    const runId = await seedRun('please fix');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    const env = await kube.podEnv(`run-${runId}`);
    expect(env?.PROMPT).toContain('Use the skill "fix"');
    expect((await load(runId)).run?.finalPrompt).toBe(env?.PROMPT);
    await acts.deleteJob(ctx);
  });

  it("uses the prompt copied onto the run, not the rule's current text", async () => {
    const ruleId = await asOwner(async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into rules (org_id, project_id, command, agent_id, skill_name, prompt)
         values ($1, $2, 'edited-later', $3, null, 'old') returning id`,
        [ORG, projectId, AGENT],
      );
      return r.rows[0]?.id ?? '';
    });
    const runId = await seedPromptRun('old', 'x', ruleId);
    await asOwner((c) => c.query(`update rules set prompt = 'new' where id = $1`, [ruleId]));
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(await ctxFor(runId));
    expect((await kube.podEnv(`run-${runId}`))?.PROMPT?.startsWith('old')).toBe(true);
    await acts.deleteJob(await ctxFor(runId));
  });
});

describe('createRunSecretAndJob setup script', () => {
  async function saveVersion(version: number, body: string): Promise<void> {
    await withOrg(db, ORG, (tx) =>
      tx.insert(setupScriptVersions).values({ orgId: ORG, projectId, version, body, createdBy: 'tester' }),
    );
  }
  // Later suites seed runs on the same project and expect no setup script.
  afterAll(async () => {
    await asOwner((c) => c.query('delete from setup_script_versions where project_id = $1', [projectId]));
  });
  const versionOf = async (runId: string) => (await load(runId)).run?.setupScriptVersion;

  it('no saved script: the column stays null and the Job has no SETUP_SCRIPT', async () => {
    const runId = await seedRun('x');
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(await ctxFor(runId));
    expect((await kube.podEnv(`run-${runId}`))?.SETUP_SCRIPT).toBeUndefined();
    expect(await versionOf(runId)).toBeNull();
    await acts.deleteJob(await ctxFor(runId));
  });

  it('passes the current script and records its version', async () => {
    const body = 'echo "héllo ✓"\r\nnpm ci';
    await saveVersion(1, 'echo old');
    await saveVersion(2, body);
    const runId = await seedRun('x');
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(await ctxFor(runId));
    expect((await kube.podEnv(`run-${runId}`))?.SETUP_SCRIPT).toBe(body);
    expect(await versionOf(runId)).toBe(2);
    await acts.deleteJob(await ctxFor(runId));
  });

  it('an empty current script records nothing and sets no SETUP_SCRIPT', async () => {
    await saveVersion(3, '');
    const runId = await seedRun('x');
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(await ctxFor(runId));
    expect((await kube.podEnv(`run-${runId}`))?.SETUP_SCRIPT).toBeUndefined();
    expect(await versionOf(runId)).toBeNull();
    await acts.deleteJob(await ctxFor(runId));
  });

  it('retry reuses the recorded script version', async () => {
    await saveVersion(4, 'echo four');
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const failing = wrapKube({
      ensureJob: async () => {
        throw new Error('500 etcd unavailable');
      },
    });
    await createRunActivities(deps({ kube: failing }))
      .createRunSecretAndJob(ctx)
      .catch(() => undefined);
    expect(await versionOf(runId)).toBe(4);
    await saveVersion(5, 'echo five');
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    expect((await kube.podEnv(`run-${runId}`))?.SETUP_SCRIPT).toBe('echo four');
    expect(await versionOf(runId)).toBe(4);
    await acts.deleteJob(ctx);
  });

  it('a Job failure leaks no script text into the error (it can become the failure reason posted to the ticket)', async () => {
    const body = 'echo "run-path-secret-script-body" && make setup';
    await saveVersion(6, body);
    const runId = await seedRun('x');
    const failing = wrapKube({
      ensureJob: async () => {
        throw new Error(`apply failed for ${body}`);
      },
    });
    const err = await createRunActivities(deps({ kube: failing }))
      .createRunSecretAndJob(await ctxFor(runId))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('run-path-secret-script-body');
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

// The fake pod's log up to the agent starting, as lifecycle kinds (one log line each); the first turn finishes next.
const PRELUDE_KINDS = ['checkout', 'plugins_begin', 'plugins_end', 'setup_skipped', 'session_started'];
// The pod also logs `git identity <name> <email>`: a plain text line, so it counts as a log line but stores no event.
const PRELUDE_TEXT_LINES = 1;
// The fake pod's first turn logs `state working` then `state needs_input`; the first turn's end is the first replayable boundary.
const FIRST_TURN_LINE = PRELUDE_KINDS.length + PRELUDE_TEXT_LINES + 2;

describe('followPodLogs', () => {
  it('redacts the current and an earlier workspace token after a refresh (pattern covers the old one)', async () => {
    const old = 'ghs_rotated1ABCDEFGHIJKLMNOPQRST';
    const current = 'ghs_rotated2ABCDEFGHIJKLMNOPQRST';
    const runId = await seedRun(`echo ${old} then ${current}`);
    const ctx = await ctxFor(runId);
    const { adapters } = rotatingAdapters();
    const acts = createRunActivities(deps({ adapters }));
    await acts.createRunSecretAndJob(ctx);
    await acts.refreshWorkspaceToken(ctx);
    expect((await kube.readSecret(`run-${runId}`))?.['workspace-token']).toBe(current);
    const f = follow(ctx, deps({ adapters }));
    await until(async () => (await load(runId)).run?.status === 'idle');
    await acts.endSession(ctx);
    const result = await f.promise;
    expect(result.scrollbackTail).not.toContain('ghs_rotated');
    const { events } = await load(runId);
    expect(JSON.stringify(events)).not.toContain('ghs_rotated');
    expect(JSON.stringify(events)).toContain('***');
    await acts.deleteJob(ctx);
  });

  it('writes running then idle, signals agentState needs_input, stores one redacted scrollback, returns the exit code', async () => {
    const runId = await seedRun(`echo ${CRED} please`);
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    const f = follow(ctx, deps());
    await until(async () => (await load(runId)).run?.status === 'idle');
    await until(async () =>
      signals.some((s) => s.runId === runId && s.signal === 'agentState' && s.arg === 'needs_input'),
    );
    await acts.endSession(ctx);
    const result = await f.promise;
    expect(result.exitCode).toBe(0);
    expect(result.scrollbackTail).toContain('***');
    expect(result.scrollbackTail).not.toContain(CRED);

    const { events } = await load(runId);
    expect(await statuses(runId)).toEqual(['running', 'idle']);
    const lifecycle = events.filter((e) => e.type === 'lifecycle').map((e) => e.payload.kind);
    // The runner's end line (the fake pod logs it after `agentdesk-end`) is the last lifecycle event.
    expect(lifecycle).toEqual([...PRELUDE_KINDS, 'agent_state', 'agent_state', 'session_ended']);
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

  it('endSession records session_ending_at before ending the session and keeps the first moment on a repeat', async () => {
    const runId = await seedRun('end me');
    const ctx = await ctxFor(runId);
    const first = new Date('2026-04-01T10:00:00.000Z');
    const acts = createRunActivities(deps({ clock: { now: () => first } }));
    await acts.createRunSecretAndJob(ctx);
    const f = follow(ctx, deps());
    await until(async () => (await load(runId)).run?.status === 'idle');
    expect((await load(runId)).run?.sessionEndingAt).toBeNull();
    await acts.endSession(ctx);
    expect((await load(runId)).run?.sessionEndingAt?.toISOString()).toBe(first.toISOString());
    await createRunActivities(deps({ clock: { now: () => new Date('2026-04-01T10:05:00.000Z') } })).endSession(ctx);
    expect((await load(runId)).run?.sessionEndingAt?.toISOString()).toBe(first.toISOString());
    await f.promise;
    await acts.deleteJob(ctx);
  });

  it('Review Focus 3: resumed after cancel at the first turn line, no duplicate rows and no running after idle', async () => {
    const runId = await seedRun('resume me');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);

    const first = follow(ctx, deps());
    await until(async () => first.beats.some((b) => lastLineOf(b) >= FIRST_TURN_LINE));
    first.env.cancel();
    await expect(first.promise).rejects.toBeInstanceOf(CancelledFailure);
    expect((await load(runId)).run?.status).toBe('idle');

    // The worker restarted: the retry gets the last heartbeat's details.
    const second = follow(ctx, deps(), { lastLine: FIRST_TURN_LINE });
    await sleep(300);
    // Another turn (the user typed in the terminal).
    const attach = await kube.exec(`run-${runId}`, ['tmux', 'attach', '-t', 'agent'], { tty: true });
    attach.write(new TextEncoder().encode('again\r'));
    await until(
      async () =>
        (await load(runId)).events.filter((e) => e.type === 'lifecycle').length >=
          FIRST_TURN_LINE - PRELUDE_TEXT_LINES + 2 && second.beats.length,
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
      ...PRELUDE_KINDS,
      'agent_state',
      'agent_state',
      'agent_state',
      'agent_state',
      'session_ended',
    ]);
    // The agent's own `working` lines (not terminal input) signal agentState working once each (first turn, then the
    // typed one), even across the replaying retry.
    expect(signals.filter((s) => s.runId === runId && s.signal === 'agentState' && s.arg === 'working')).toHaveLength(
      2,
    );
    expect(events.filter((e) => e.type === 'scrollback')).toHaveLength(1);
    // The typed turn's `working` line resumes the run, its end line idles it again; the replays change nothing.
    expect(await statuses(runId)).toEqual(['running', 'idle', 'running', 'idle']);
    await acts.deleteJob(ctx);
  });

  describe('agent state lines', () => {
    const b64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');
    const rewrite = (map: (line: string) => string) =>
      wrapKube({
        async *streamLogs(n, s) {
          for await (const line of kube.streamLogs(n, s)) yield map(line);
        },
      });
    const agentSignals = (runId: string) => signals.filter((s) => s.runId === runId && s.signal === 'agentState');

    it('done line writes done with a redacted note and signals agentState done', async () => {
      const runId = await seedRun('finish --fake-done');
      const ctx = await ctxFor(runId);
      const leaky = rewrite((l) =>
        l.startsWith('agentdesk: state done ') ? `agentdesk: state done declared ${b64(`all done ${CRED}`)}` : l,
      );
      const acts = createRunActivities(deps({ kube: leaky }));
      await acts.createRunSecretAndJob(ctx);
      const f = follow(ctx, deps({ kube: leaky }));
      await until(async () => (await load(runId)).run?.status === 'done');
      await until(async () => agentSignals(runId).some((s) => s.arg === 'done'));
      await acts.endSession(ctx);
      await f.promise;

      const { run, events } = await load(runId);
      expect(run?.agentNote).toContain('all done');
      expect(run?.agentNote).not.toContain(CRED);
      expect(JSON.stringify(events)).not.toContain(CRED);
      const stored = events.filter((e) => e.type === 'lifecycle' && e.payload.kind === 'agent_state');
      expect(stored.map((e) => e.payload.state)).toEqual(['working', 'done']);
      expect(stored[1]?.payload).toMatchObject({ state: 'done', source: 'declared', waitingOn: null });
      expect(JSON.stringify(stored)).not.toContain('all done');
      expect(await statuses(runId)).toEqual(['running', 'done']);
      await acts.deleteJob(ctx);
    });

    it('a secret straddling the 500-char note cap never leaves a prefix in the stored note', async () => {
      const runId = await seedRun('finish --fake-done');
      const ctx = await ctxFor(runId);
      // The credential starts 10 chars before the cap, so truncating first would cut it mid-value.
      const note = `${'x'.repeat(490)}${CRED} tail`;
      const leaky = rewrite((l) =>
        l.startsWith('agentdesk: state done ') ? `agentdesk: state done declared ${b64(note)}` : l,
      );
      const acts = createRunActivities(deps({ kube: leaky }));
      await acts.createRunSecretAndJob(ctx);
      const f = follow(ctx, deps({ kube: leaky }));
      await until(async () => (await load(runId)).run?.status === 'done');
      await acts.endSession(ctx);
      await f.promise;

      const { run, events } = await load(runId);
      expect(run?.agentNote?.length).toBeLessThanOrEqual(500);
      for (const prefix of [CRED, CRED.slice(0, 10), CRED.slice(0, 3)]) expect(run?.agentNote).not.toContain(prefix);
      for (const prefix of [CRED, CRED.slice(0, 10)]) expect(JSON.stringify(events)).not.toContain(prefix);
      await acts.deleteJob(ctx);
    });

    it('waiting line writes running with waitingOn background', async () => {
      const runId = await seedRun('build --fake-background');
      const ctx = await ctxFor(runId);
      const acts = createRunActivities(deps());
      await acts.createRunSecretAndJob(ctx);
      const f = follow(ctx, deps());
      await until(async () => (await load(runId)).run?.status === 'idle');
      await acts.endSession(ctx);
      await f.promise;
      const status = (await load(runId)).events.filter((e) => e.type === 'status');
      expect(status.map((e) => [e.payload.status, e.payload.waitingOn])).toEqual([
        ['running', null],
        ['running', 'background'],
        ['running', null],
        ['idle', null],
      ]);
      await acts.deleteJob(ctx);
    });

    it('legacy turn finished still writes idle and signals', async () => {
      const runId = await seedRun('legacy');
      const ctx = await ctxFor(runId);
      const legacy = rewrite((l) =>
        l === 'agentdesk: state working'
          ? 'agentdesk: turn started'
          : l.startsWith('agentdesk: state needs_input ')
            ? 'agentdesk: turn finished'
            : l,
      );
      const acts = createRunActivities(deps({ kube: legacy }));
      await acts.createRunSecretAndJob(ctx);
      const f = follow(ctx, deps({ kube: legacy }));
      await until(async () => (await load(runId)).run?.status === 'idle');
      await until(async () => agentSignals(runId).some((s) => s.arg === 'needs_input'));
      await acts.endSession(ctx);
      await f.promise;
      expect(await statuses(runId)).toEqual(['running', 'idle']);
      await acts.deleteJob(ctx);
    });

    it('replayed done line does not re-signal after the run moved on', async () => {
      const runId = await seedRun('replay --fake-done');
      const ctx = await ctxFor(runId);
      const acts = createRunActivities(deps());
      await acts.createRunSecretAndJob(ctx);
      const first = follow(ctx, deps());
      await until(async () => agentSignals(runId).some((s) => s.arg === 'done'));
      await acts.endSession(ctx);
      await first.promise;
      expect(agentSignals(runId).filter((s) => s.arg === 'done')).toHaveLength(1);

      await asOwner((c) => c.query(`update runs set status = 'running' where id = $1`, [runId]));
      const replay = follow(ctx, deps(), { lastLine: 0 });
      await replay.promise;
      expect(agentSignals(runId).filter((s) => s.arg === 'done')).toHaveLength(1);
      expect((await load(runId)).run?.status).toBe('running');
      await acts.deleteJob(ctx);
    });
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
      'setup_skipped',
      'setup_output',
      'plugin_output',
      'plugin_installed',
    ]);
    release();
    // Wait for the first turn to finish: ending the session earlier races the turn_finished line.
    await until(async () => (await load(runId)).run?.status === 'idle');
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
      'plugin_output',
      'plugin_installed',
      'plugin_failed',
      'plugins_end',
      'setup_skipped',
      'session_started',
      'agent_state',
      'agent_state',
      'session_ended',
    ]);
    expect(lifecycle[0]?.payload.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(lifecycle[2]?.payload).toMatchObject({ kind: 'plugin_output', text: 'noisy output', truncated: false });
    expect(lifecycle[3]?.payload).toMatchObject({
      kind: 'plugin_installed',
      pluginId: 'demo@acme',
      text: 'agentdesk: plugin installed demo@acme',
    });
    expect(lifecycle[4]?.payload.pluginId).toBe('bad@acme');
    await acts.deleteJob(ctx);
  });

  describe('setup phase', () => {
    const SETUP_FAIL_VERSION = 90;
    async function seedFailingSetupRun(): Promise<string> {
      await withOrg(db, ORG, (tx) =>
        tx.insert(setupScriptVersions).values({
          orgId: ORG,
          projectId,
          version: SETUP_FAIL_VERSION,
          body: 'npm ci # --fake-setup-fail',
          createdBy: 't',
        }),
      );
      return seedRun('setup fail');
    }
    afterEach(async () => {
      await asOwner((c) => c.query('delete from setup_script_versions where project_id = $1', [projectId]));
    });
    const lifecycleOf = async (runId: string) => (await load(runId)).events.filter((e) => e.type === 'lifecycle');
    /** A pod that has exited with `exitCode` after printing `lines`. */
    const exited = (lines: string[], exitCode: number, pause?: Promise<void>): KubeGateway =>
      wrapKube({
        readSecret: async () => null,
        getRunPod: async (name) => ({ name, phase: 'Failed', pendingSince: null, reason: null, exitCode }),
        streamLogs: async function* () {
          yield* lines;
          if (pause) await pause;
        },
      });

    it('setup failure returns failureStage setup; status stays starting; output stored redacted', async () => {
      const runId = await seedFailingSetupRun();
      const ctx = await ctxFor(runId);
      const acts = createRunActivities(deps());
      await acts.createRunSecretAndJob(ctx);
      await asOwner((c) => c.query('delete from setup_script_versions where project_id = $1', [projectId]));
      const injected = wrapKube({
        async *streamLogs(n, s) {
          for await (const line of kube.streamLogs(n, s)) {
            if (line === 'agentdesk: setup failed exit=1') {
              yield `setup| npm ERR! token ${CRED} rejected`;
              yield 'setup| second line';
            }
            yield line;
          }
        },
      });
      const r = await follow(ctx, deps({ kube: injected })).promise;
      expect(r).toMatchObject({ exitCode: 78, failureStage: 'setup', setupExitCode: 1 });
      const { run, events } = await load(runId);
      expect(run?.status).toBe('starting');
      expect(await statuses(runId)).toEqual([]);
      const lifecycle = events.filter((e) => e.type === 'lifecycle');
      expect(lifecycle.map((e) => e.payload.kind)).toEqual([
        'checkout',
        'plugins_begin',
        'plugins_end',
        'setup_begin',
        'setup_output',
        'setup_failed',
      ]);
      const out = lifecycle[4]?.payload;
      expect(out?.text).toBe('npm ERR! token *** rejected\nsecond line');
      expect(out?.truncated).toBe(false);
      expect(JSON.stringify(events)).not.toContain(CRED);
      expect(lifecycle[5]?.payload).toMatchObject({ kind: 'setup_failed', exitCode: 1 });
      await acts.deleteJob(ctx);
    });

    it('a pod that exits during setup (setup_failed marker then exit) is a setup failure, buffered output flushed', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const r = await follow(
        ctx,
        deps({
          kube: exited(['agentdesk: setup begin', 'setup| boom', 'agentdesk: setup failed exit=2', 'setup| tail'], 78),
        }),
      ).promise;
      expect(r).toMatchObject({ exitCode: 78, failureStage: 'setup', setupExitCode: 2 });
      const lifecycle = await lifecycleOf(runId);
      expect(lifecycle.map((e) => e.payload.kind)).toEqual([
        'setup_begin',
        'setup_output',
        'setup_failed',
        'setup_output',
      ]);
      expect(lifecycle[2]?.payload.exitCode).toBe(2);
      expect(lifecycle[3]?.payload.text).toBe('tail');
    });

    it('setup timed out then exit is a setup failure without an exit code', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const r = await follow(ctx, deps({ kube: exited(['agentdesk: setup begin', 'agentdesk: setup timed out'], 78) }))
        .promise;
      expect(r.failureStage).toBe('setup');
      expect(r.setupExitCode).toBeUndefined();
    });

    it('a pod killed before the agent started: no markers, exit 137 -> no setup stage, agentStarted false', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const r = await follow(ctx, deps({ kube: exited(['agentdesk: checkout ' + '0'.repeat(40)], 137) })).promise;
      expect(r.exitCode).toBe(137);
      expect(r.failureStage).toBeUndefined();
      expect(r.agentStarted).toBe(false);
    });

    it('exit 78 before the session started is a setup failure even without a marker', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const r = await follow(ctx, deps({ kube: exited(['agentdesk: plugins begin'], 78) })).promise;
      expect(r).toMatchObject({ exitCode: 78, failureStage: 'setup', setupExitCode: 78, agentStarted: false });
    });

    it('agentStarted is true once session_started is stored', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const r = await follow(ctx, deps({ kube: exited(['agentdesk: session started'], 137) })).promise;
      expect(r).toMatchObject({ exitCode: 137, agentStarted: true });
      expect(r.failureStage).toBeUndefined();
    });

    describe('session end marker and a vanished pod', () => {
      /** A pod that is there for the pod wait, then gone once the lines were printed (the gateway no longer finds it). */
      const vanished = (lines: string[]): KubeGateway => {
        let calls = 0;
        return wrapKube({
          readSecret: async () => null,
          getRunPod: async (name) =>
            ++calls === 1 ? { name, phase: 'Running', pendingSince: null, reason: null, exitCode: null } : null,
          streamLogs: async function* () {
            yield* lines;
          },
        });
      };

      /** A stored end event holds the line number (added by the store), the kind, the reason and the code: no log text. */
      const expectOnlyEndFields = (payloads: Record<string, unknown>[]): void => {
        for (const p of payloads) {
          expect(Object.keys(p).sort()).toEqual(['code', 'kind', 'line', 'reason']);
          expect(Object.values(p).some((v) => typeof v === 'string' && v.includes('agentdesk:'))).toBe(false);
        }
      };

      it('returns the reason from the last end line and stores only the reason and the code', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        const lines = [
          'agentdesk: session started',
          'agentdesk: session ended reason=agent_exit code=1',
          'agentdesk: session ended reason=signal code=143',
        ];
        const r = await follow(ctx, deps({ kube: exited(lines, 143) })).promise;
        expect(r).toMatchObject({ exitCode: 143, agentStarted: true, endReason: 'signal' });
        expect(r.podLost).toBeUndefined();
        const ended = (await lifecycleOf(runId)).filter((e) => e.payload.kind === 'session_ended');
        expectOnlyEndFields(ended.map((e) => e.payload));
        expect(ended.map(({ payload: p }) => ({ kind: p.kind, reason: p.reason, code: p.code }))).toEqual([
          { kind: 'session_ended', reason: 'agent_exit', code: 1 },
          { kind: 'session_ended', reason: 'signal', code: 143 },
        ]);
      });

      it('reads the end line printed right after the final scrollback block (the runner order)', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        const fake = 'agentdesk: session ended reason=signal code=9';
        const lines = [
          'agentdesk: session started',
          'agentdesk: final scrollback begin',
          'pane one',
          fake, // a pane line that looks like the end line, before the end marker
          'agentdesk: final scrollback end',
          'agentdesk: session ended reason=agent_exit code=0',
        ];
        const r = await follow(ctx, deps({ kube: exited(lines, 0) })).promise;
        expect(r).toMatchObject({ exitCode: 0, endReason: 'agent_exit' });
        const { events } = await load(runId);
        const ended = events.filter((e) => e.type === 'lifecycle' && e.payload.kind === 'session_ended');
        expectOnlyEndFields(ended.map((e) => e.payload));
        expect(ended.map(({ payload: p }) => ({ kind: p.kind, reason: p.reason, code: p.code }))).toEqual([
          { kind: 'session_ended', reason: 'agent_exit', code: 0 },
        ]);
        const scrollback = events.filter((e) => e.type === 'scrollback');
        expect(scrollback).toHaveLength(1);
        expect(String(scrollback[0]?.payload.text)).toBe(`pane one\n${fake}`);
      });

      it('podLost: the pod ended with no exit code (phase Unknown) after session started', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        let calls = 0;
        const unknown = wrapKube({
          readSecret: async () => null,
          getRunPod: async (name) =>
            ++calls === 1
              ? { name, phase: 'Running', pendingSince: null, reason: null, exitCode: null }
              : { name, phase: 'Unknown', pendingSince: null, reason: 'NodeLost', exitCode: null },
          streamLogs: async function* () {
            yield 'agentdesk: session started';
          },
        });
        // A clock that jumps past the exit wait, so the pod that never reports an exit code is judged at once.
        let t = Date.now();
        const clock: Clock = { now: () => new Date((t += 30_000)) };
        const r = await follow(ctx, deps({ kube: unknown, clock })).promise;
        expect(r).toMatchObject({
          exitCode: -1,
          podLost: true,
          agentStarted: true,
          lostText: 'the run pod ended (Unknown) without an exit code: NodeLost',
        });
      });

      it('a pod that ended with an exit code and no end line is not podLost', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        const r = await follow(ctx, deps({ kube: exited(['agentdesk: session started'], 1) })).promise;
        expect(r).toMatchObject({ exitCode: 1, agentStarted: true });
        expect(r.podLost).toBeUndefined();
        expect(r.endReason).toBeUndefined();
      });

      it('ignores an end line whose code differs from the pod real exit code (a forged line)', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        const lines = ['agentdesk: session started', 'agentdesk: session ended reason=agent_exit code=0'];
        const r = await follow(ctx, deps({ kube: exited(lines, 137) })).promise;
        expect(r).toMatchObject({ exitCode: 137, agentStarted: true });
        expect(r.endReason).toBeUndefined();
      });

      it('treats an end line with an unknown reason as plain output: no endReason, no event', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        const lines = ['agentdesk: session started', 'agentdesk: session ended reason=evil code=0'];
        const r = await follow(ctx, deps({ kube: exited(lines, 0) })).promise;
        expect(r.endReason).toBeUndefined();
        expect((await lifecycleOf(runId)).filter((e) => e.payload.kind === 'session_ended')).toEqual([]);
      });

      it('podLost: the pod vanished after session started with no end line', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        const r = await follow(ctx, deps({ kube: vanished(['agentdesk: session started']) })).promise;
        expect(r).toMatchObject({
          exitCode: -1,
          podLost: true,
          agentStarted: true,
          lostText: 'the run pod disappeared before it reported an exit code',
        });
        expect(r.endReason).toBeUndefined();
      });

      it('still fails without retry when the pod vanished before session started', async () => {
        const runId = await seedRun('x');
        const ctx = await ctxFor(runId);
        const err = await follow(ctx, deps({ kube: vanished(['agentdesk: plugins begin']) })).promise.catch(
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(ApplicationFailure);
        expect((err as ApplicationFailure).nonRetryable).toBe(true);
      });
    });

    it('a later pass after truncation stores no further output chunks and no second truncated chunk', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const big = 'y'.repeat(1000);
      const first = ['agentdesk: setup begin', ...Array.from({ length: 300 }, () => `setup| ${big}`)];
      const f1 = follow(ctx, deps({ kube: exited(first, 78) }));
      const r1 = await f1.promise;
      expect(r1.exitCode).toBe(78);
      const outputs = async () => (await lifecycleOf(runId)).filter((e) => e.payload.kind === 'setup_output');
      const stored = await outputs();
      expect(stored.filter((e) => e.payload.truncated === true)).toHaveLength(1);
      const lastLine = Math.max(...f1.beats.map(lastLineOf));
      const more = [...first, ...Array.from({ length: 60 }, () => `setup| ${big}`), 'agentdesk: setup passed'];
      await follow(ctx, deps({ kube: exited(more, 78) }), { lastLine }).promise;
      const after = await outputs();
      expect(after).toHaveLength(stored.length);
      expect(after.filter((e) => e.payload.truncated === true)).toHaveLength(1);
    });

    it('a secret straddling the maxChars cut never leaves a prefix in a stored event', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const MAX = 262_144;
      const filler = 'z'.repeat(1000);
      const full = Math.floor((MAX - 100) / 1001); // lines of 1000 chars (+1 join each)
      const used = full * 1001;
      const gap = MAX - used - 1 - 6; // leaves room 5 for the next line
      const lines = [
        ...Array.from({ length: full }, () => `setup| ${filler}`),
        `setup| ${'q'.repeat(gap - 1)}`,
        `setup| ${CRED}`,
      ];
      const injected = wrapKube({
        readSecret: async () => ({ REPO_CLONE_URL: 'https://fake.invalid/dev/demo.git' }),
        getRunPod: async (name) => ({ name, phase: 'Failed', pendingSince: null, reason: null, exitCode: 78 }),
        streamLogs: async function* () {
          yield* lines;
        },
      });
      await follow(ctx, deps({ kube: injected })).promise;
      const all = JSON.stringify((await load(runId)).events);
      expect(all).not.toContain('sk-a');
      expect(all).not.toContain(CRED);
    });

    it('no failureStage when the session started, or when the run only fails later', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const r = await follow(
        ctx,
        deps({ kube: exited(['agentdesk: setup failed exit=1', 'agentdesk: session started'], 3) }),
      ).promise;
      expect(r.exitCode).toBe(3);
      expect(r.failureStage).toBeUndefined();
    });

    it('chunks output at 50 lines, and a replay from line 0 adds nothing', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const lines = [
        'agentdesk: setup begin',
        ...Array.from({ length: 120 }, (_, i) => `setup| l${i}`),
        'agentdesk: setup passed',
        'agentdesk: session started',
      ];
      const pod = exited(lines, 0);
      await follow(ctx, deps({ kube: pod })).promise;
      const chunks = async () => (await lifecycleOf(runId)).filter((e) => e.payload.kind === 'setup_output');
      expect((await chunks()).map((e) => String(e.payload.text).split('\n').length)).toEqual([50, 50, 20]);
      const total = (await lifecycleOf(runId)).length;
      await follow(ctx, deps({ kube: pod }), { lastLine: 0 }).promise;
      expect((await lifecycleOf(runId)).length).toBe(total);
      expect(await statuses(runId)).toEqual(['running']);
    });

    it('durable (the heartbeat) never passes output lines that are buffered but not stored', async () => {
      const runId = await seedRun('x');
      const ctx = await ctxFor(runId);
      const lines = ['agentdesk: setup begin', ...Array.from({ length: 60 }, (_, i) => `setup| l${i}`)];
      let release: () => void = () => undefined;
      const hold = new Promise<void>((r) => (release = r));
      const f = follow(ctx, deps({ kube: exited(lines, 78, hold) }));
      await until(async () => (await lifecycleOf(runId)).some((e) => e.payload.kind === 'setup_output'));
      await sleep(500); // several heartbeats
      // Lines 1..51 are stored (setup begin + the first 50 output lines); 10 lines are still buffered.
      const max = Math.max(...f.beats.map(lastLineOf));
      expect(max).toBe(51);
      f.env.cancel();
      release();
      await expect(f.promise).rejects.toBeInstanceOf(CancelledFailure);
      // The retry resumes from the heartbeat and stores the remainder once.
      const retry = await follow(ctx, deps({ kube: exited(lines, 78) }), { lastLine: max }).promise;
      expect(retry.exitCode).toBe(78);
      const texts = (await lifecycleOf(runId))
        .filter((e) => e.payload.kind === 'setup_output')
        .map((e) => String(e.payload.text).split('\n').length);
      expect(texts).toEqual([50, 10]);
    });
  });

  it('does not write running when the run is no longer starting', async () => {
    const runId = await seedRun('x', 'idle');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    // Agent state lines would move an idle run (that is their job); this test is about `session_started` only.
    const quiet = wrapKube({
      async *streamLogs(n, s) {
        for await (const line of kube.streamLogs(n, s)) if (!line.startsWith('agentdesk: state ')) yield line;
      },
    });
    const f = follow(ctx, deps({ kube: quiet }));
    await until(async () =>
      (await load(runId)).events.some((e) => e.type === 'lifecycle' && e.payload.kind === 'session_started'),
    );
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

describe('followPodLogs: cluster contact loss', () => {
  const fetchFailed = (): TypeError => new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
  const running = (name: string): RunPod => ({
    name,
    phase: 'Running',
    pendingSince: null,
    reason: null,
    exitCode: null,
  });
  const contactEvents = async (runId: string) =>
    (await load(runId)).events.filter(
      (e) => e.type === 'lifecycle' && (e.payload.kind === 'contact_lost' || e.payload.kind === 'contact_restored'),
    );

  it('stream ends, then getRunPod fails transiently, then the pod reports its exit code: one contact_lost and one contact_restored event, fixed text', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    let t = Date.now();
    let calls = 0;
    const gw = wrapKube({
      readSecret: async () => null,
      getRunPod: async (name) => {
        calls += 1;
        if (calls === 1) return running(name); // the pod wait
        if (calls === 2) throw fetchFailed(); // waitForExit, right after the stream ended
        t += 2 * 60_000; // the outage lasted two minutes
        return { name, phase: 'Failed', pendingSince: null, reason: null, exitCode: 0 };
      },
      streamLogs: async function* () {
        yield 'agentdesk: session started';
      },
    });
    const r = await follow(ctx, deps({ kube: gw, clock: { now: () => new Date(t) } })).promise;
    expect(r).toMatchObject({ exitCode: 0, agentStarted: true });
    expect(r.contactLost).toBeUndefined();
    const events = await contactEvents(runId);
    expect(events.map((e) => e.payload)).toEqual([
      { kind: 'contact_lost', text: 'Lost contact with the cluster (ECONNRESET). Retrying.' },
      { kind: 'contact_restored', text: 'Contact with the cluster restored after 2 min.' },
    ]);
    expect(JSON.stringify(events)).not.toContain('fetch failed');
  });

  /** A pod that is there for the pod wait, then every cluster call fails; the clock jumps 70 s per reading. */
  const outage = (lines: string[]) => {
    let calls = 0;
    let t = Date.now();
    const gw = wrapKube({
      readSecret: async () => null,
      getRunPod: async (name) => {
        if (++calls === 1) return running(name);
        throw fetchFailed();
      },
      streamLogs: async function* () {
        yield* lines;
      },
    });
    const clock: Clock = { now: () => new Date((t += 70_000)) };
    return { gw, clock, timing: { pollMs: 50, heartbeatMs: 200, reconnectWindowMs: 60_000 } };
  };

  it('window passes after the agent started: podLost and contactLost with the window in the text', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const o = outage(['agentdesk: session started', 'some output']);
    const r = await follow(ctx, deps({ kube: o.gw, clock: o.clock, timing: o.timing })).promise;
    expect(r).toMatchObject({
      exitCode: -1,
      agentStarted: true,
      podLost: true,
      contactLost: true,
      lostText: 'lost contact with the cluster for 1 min',
      scrollbackTail: 'some output',
    });
    expect((await contactEvents(runId)).map((e) => e.payload.kind)).toEqual(['contact_lost']);
  });

  it('window passes before the agent started: a non-retryable failure', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const o = outage([]);
    const err = await follow(ctx, deps({ kube: o.gw, clock: o.clock, timing: o.timing })).promise.catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).message).toContain('lost contact with the cluster before the agent started');
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
  it('the start comment of a prompt run says custom prompt', async () => {
    const runId = await seedPromptRun('Triage this.', 'x');
    const ctx = await ctxFor(runId);
    const before = (await store.listPosted()).length;
    await createRunActivities(deps()).postComment(ctx, 'start');
    const body = (await store.listPosted()).slice(before)[0]?.body ?? '';
    expect(body).toContain('(`/fix`, custom prompt)');
    expect(body).not.toContain('skill');
  });
});

describe('postComment finish after a re-open', () => {
  it('posts a finish comment again when the end status differs, and once per status', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    const before = (await store.listPosted()).length;
    await acts.postComment(ctx, 'finish', { status: 'succeeded' });
    await acts.postComment(ctx, 'finish', { status: 'succeeded' });
    expect((await store.listPosted()).slice(before)).toHaveLength(1);
    const failed = { status: 'failed' as const, exitCode: 1, failureReason: 'agent exited with code 1' };
    await acts.postComment(ctx, 'finish', failed);
    await acts.postComment(ctx, 'finish', failed);
    const posted = (await store.listPosted()).slice(before);
    expect(posted).toHaveLength(2);
    expect(posted[0]?.body).toContain('**succeeded**');
    expect(posted[1]?.body).toContain('**failed**');
    const { run, events } = await load(runId);
    expect(run?.outbox.finish).toMatchObject({ status: 'failed' });
    expect(events.filter((e) => e.type === 'comment').map((e) => e.payload.kind)).toEqual(['finish', 'finish']);
  });

  it('treats a finish marker without a status (written before this change) as already posted', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    await withOrg(db, ORG, (tx) =>
      tx
        .update(runs)
        .set({ outbox: { finish: { commentId: 'c1', at: new Date().toISOString() } } })
        .where(eq(runs.id, runId)),
    );
    const acts = createRunActivities(deps());
    const before = (await store.listPosted()).length;
    await acts.postComment(ctx, 'finish', { status: 'failed' });
    expect((await store.listPosted()).slice(before)).toHaveLength(0);
  });
});

describe('postComment setup failure', () => {
  it('says setup failed and the agent did not start, with the reason and the run link', async () => {
    const runId = await seedRun('x');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    const before = (await store.listPosted()).length;
    await acts.postComment(ctx, 'finish', {
      status: 'failed',
      exitCode: 1,
      failureReason: 'setup failed (exit 1)',
      failureStage: 'setup',
    });
    const body = (await store.listPosted()).slice(before)[0]?.body ?? '';
    const number = (await load(runId)).run?.number;
    expect(body.split('\n').filter((l) => l !== '')).toEqual([
      `Agent Desk run #${number} failed during workspace setup; the agent did not start.`,
      'Reason: setup failed (exit 1)',
      `Run: http://localhost:5173/o/acme/p/${projectId}/runs/${number}`,
    ]);
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
    const out = await reconcile({ db, kube, temporal, setupTest: SETUP_LIMITS });
    const left = (await kube.listRunJobs()).map((j) => j.runId);
    expect(left).toContain(liveRun);
    expect(left).not.toContain(finalRun);
    expect(left).not.toContain(closedRun);
    expect(left).not.toContain('66666666-6666-4666-8666-666666666666');
    expect(await kube.readSecret(`run-${finalRun}`)).toBeNull();
    expect(released).toEqual([{ projectId, runId: closedRun }]);
    expect(out).toEqual({ deletedJobs: 3, deletedSecrets: 0, releasedSlots: 1, ...NO_SETUP_TEST_DELETES });
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
      setupTest: SETUP_LIMITS,
      temporal: {
        isWorkflowOpen: async (id) => open.has(id),
        listOpenGateProjectIds: async () => [],
        gateRuns: async () => [],
        releaseSlot: async () => undefined,
      },
    });
    expect(out).toEqual({ deletedJobs: 0, deletedSecrets: 3, releasedSlots: 0, ...NO_SETUP_TEST_DELETES });
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

describe('postComment paused', () => {
  it('posts once across two calls, with the run link, and records the outbox key', async () => {
    const runId = await seedRun('x', 'paused');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    const before = (await store.listPosted()).length;
    await acts.postComment(ctx, 'paused');
    await acts.postComment(ctx, 'paused');
    const posted = (await store.listPosted()).slice(before);
    expect(posted).toHaveLength(1);
    const number = (await load(runId)).run?.number;
    expect(posted[0]?.body).toContain('is paused');
    expect(posted[0]?.body).not.toContain('finished');
    expect(posted[0]?.body).toContain(`http://localhost:5173/o/acme/p/${projectId}/runs/${number}`);
    const { run, events } = await load(runId);
    expect(Object.keys(run?.outbox ?? {})).toEqual(['paused']);
    expect(events.filter((e) => e.type === 'comment').map((e) => e.payload.kind)).toEqual(['paused']);
  });
});

describe('postComment queued', () => {
  it('posts once across two calls, says the slots are in use, links the run and records the outbox key', async () => {
    const runId = await seedRun('x', 'queued');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    const before = (await store.listPosted()).length;
    await acts.postComment(ctx, 'queued');
    await acts.postComment(ctx, 'queued');
    const posted = (await store.listPosted()).slice(before);
    expect(posted).toHaveLength(1);
    const number = (await load(runId)).run?.number;
    expect(posted[0]?.body).toContain(`run #${number}`);
    expect(posted[0]?.body).toContain('queued');
    expect(posted[0]?.body).toContain('slot');
    expect(posted[0]?.body).not.toContain('started');
    expect(posted[0]?.body).toContain(`http://localhost:5173/o/acme/p/${projectId}/runs/${number}`);
    const { run, events } = await load(runId);
    expect(Object.keys(run?.outbox ?? {})).toEqual(['queued']);
    expect(events.filter((e) => e.type === 'comment').map((e) => e.payload.kind)).toEqual(['queued']);
  });
});

describe('resume mode', () => {
  const RESUME_LINES = ['agentdesk: session started'];

  /** A pod that has already exited with `exitCode` after logging `lines` (a new pod: its log starts at line 1). */
  function exitedPodKube(lines: string[], exitCode: number): KubeGateway {
    return wrapKube({
      getRunPod: async (name) => ({ name, phase: 'Succeeded', pendingSince: null, reason: null, exitCode }),
      streamLogs: async function* () {
        for (const l of lines) yield l;
      },
      readSecret: async () => ({ x: 'y' }),
    });
  }

  /** The first pod's session and the resume's `starting` write, as the workflow leaves them before the resumed pod. */
  async function seedParkedAndRestarted(): Promise<RunContext> {
    const runId = await seedRun('x', 'paused');
    // The first pod: its log lines were 1..N, so the resumed pod's line 1 collides with a stored line.
    await withOrg(db, ORG, async (tx) => {
      await appendRunEvent(tx, ORG, { runId, type: 'lifecycle', payload: { line: 1, kind: 'session_started' } });
      await appendRunEvent(tx, ORG, { runId, type: 'scrollback', payload: { line: 2, text: 'old', truncated: false } });
    });
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'queued',
      reopen: true,
      keepAgentNote: true,
      at: new Date().toISOString(),
    });
    await setRunStatus(db, {
      orgId: ORG,
      runId,
      status: 'starting',
      keepAgentNote: true,
      at: new Date().toISOString(),
    });
    return ctxFor(runId);
  }

  it('followPodLogs with resume: stores and signals session_started, writes no running status', async () => {
    const ctx = await seedParkedAndRestarted();
    const k = exitedPodKube(RESUME_LINES, 0);
    const f = follow(ctx, deps({ kube: k }), undefined, { resume: true });
    const result = await f.promise;
    expect(result).toMatchObject({ exitCode: 0, agentStarted: true });
    expect(result.resumeFailed).toBeUndefined();
    const { run, events } = await load(ctx.runId);
    // The resumed pod's line 1 is not mistaken for the first pod's line 1.
    expect(events.filter((e) => e.payload.kind === 'session_started')).toHaveLength(2);
    expect(run?.status).toBe('starting');
    expect(await statuses(ctx.runId)).toEqual(['queued', 'starting']);
    expect(signals.filter((s) => s.runId === ctx.runId && s.signal === 'sessionStarted')).toHaveLength(1);
  });

  it('a fresh start still writes running at session_started and also signals sessionStarted', async () => {
    const runId = await seedRun('x', 'starting');
    const ctx = await ctxFor(runId);
    await follow(ctx, deps({ kube: exitedPodKube(RESUME_LINES, 0) })).promise;
    expect(await statuses(runId)).toEqual(['running']);
    expect(signals.filter((s) => s.runId === runId && s.signal === 'sessionStarted')).toHaveLength(1);
  });

  it('exit 79 before session_started is resumeFailed, not a setup failure, even with an earlier session on record', async () => {
    const ctx = await seedParkedAndRestarted();
    const result = await follow(ctx, deps({ kube: exitedPodKube([], 79) }), undefined, { resume: true }).promise;
    expect(result).toMatchObject({ exitCode: 79, agentStarted: false, resumeFailed: true });
    expect(result.failureStage).toBeUndefined();
    expect(signals.filter((s) => s.runId === ctx.runId && s.signal === 'sessionStarted')).toHaveLength(0);
  });

  it('exit 79 after session_started is not resumeFailed', async () => {
    const ctx = await seedParkedAndRestarted();
    const result = await follow(ctx, deps({ kube: exitedPodKube(RESUME_LINES, 79) }), undefined, { resume: true })
      .promise;
    expect(result.resumeFailed).toBeUndefined();
    expect(result.agentStarted).toBe(true);
  });

  it('createRunSecretAndJob with resume: resume mode, no prompt, the given deadline, claim reused', async () => {
    const runId = await seedRun('do not pass again', 'queued');
    const ctx = await ctxFor(runId);
    let spec: Parameters<KubeGateway['ensureJob']>[0] | undefined;
    const k = wrapKube({
      ensureJob: async (j) => {
        spec = j;
        await kube.ensureJob(j);
      },
    });
    const acts = createRunActivities(deps({ kube: k }));
    await acts.createRunSecretAndJob(ctx, { resume: true, deadlineSeconds: 5000 });
    const env = await kube.podEnv(`run-${runId}`);
    expect(env?.RUN_MODE).toBe('resume');
    expect(env?.PROMPT).toBeUndefined();
    expect(spec?.spec?.activeDeadlineSeconds).toBe(5000 + 120);
    expect(await kube.listRunVolumeClaims()).toContainEqual(expect.objectContaining({ name: `run-${runId}` }));
    await acts.deleteJob(ctx);
    await acts.deleteRunVolume(ctx);
  });

  it('createRunSecretAndJob with resume starts a NEW pod after a park, not the finished one', async () => {
    const runId = await seedRun('park me', 'starting');
    const ctx = await ctxFor(runId);
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(ctx);
    expect((await kube.podEnv(`run-${runId}`))?.RUN_MODE).not.toBe('resume');
    await until(async () => (await kube.getRunPod(`run-${runId}`))?.phase === 'Running');
    // The idle end: the session is killed, the pod exits 0 and the finished Job is left behind.
    await acts.endSession(ctx);
    const finished = await until(async () => {
      const pod = await kube.getRunPod(`run-${runId}`);
      return pod?.exitCode === 0 ? pod : null;
    });
    expect(finished.phase).toBe('Succeeded');
    // Park: the Job and Secret go (the volume stays), so the resume cannot adopt the finished pod.
    await acts.deleteJob(ctx);
    expect(await kube.getRunPod(`run-${runId}`)).toBeNull();
    expect((await kube.listRunVolumeClaims()).some((c) => c.runId === runId)).toBe(true);
    await acts.createRunSecretAndJob(ctx, { resume: true });
    expect((await kube.podEnv(`run-${runId}`))?.RUN_MODE).toBe('resume');
    const resumed = await until(async () => {
      const pod = await kube.getRunPod(`run-${runId}`);
      return pod?.phase === 'Running' ? pod : null;
    });
    expect(resumed.exitCode).toBeNull();
    await acts.deleteJob(ctx);
    await acts.deleteRunVolume(ctx);
  });

  it('createRunSecretAndJob with resume while the old pod is still there fails retryably and creates nothing', async () => {
    const runId = await seedRun('x', 'queued');
    const ctx = await ctxFor(runId);
    const created: string[] = [];
    const k = wrapKube({
      // The old Job is still being deleted (foreground deletion): its pod is still listed.
      getRunPod: async (name) => ({ name, phase: 'Running', pendingSince: null, reason: null, exitCode: null }),
      ensureSecret: async (n, d, l) => {
        created.push(`secret:${n}`);
        await kube.ensureSecret(n, d, l);
      },
      ensureJob: async (j) => {
        created.push(`job:${j.metadata?.name ?? ''}`);
        await kube.ensureJob(j);
      },
    });
    const err = await createRunActivities(deps({ kube: k }))
      .createRunSecretAndJob(ctx, { resume: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(false);
    expect(created).toEqual([]);
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
  });

  it('createRunSecretAndJob with resume reads the agent and credential fresh from the database', async () => {
    const runId = await seedRun('x', 'queued');
    // The context was loaded when the agent was gone; the run row has an agent now.
    const stale = { ...(await ctxFor(runId)), agentId: null };
    const acts = createRunActivities(deps());
    await acts.createRunSecretAndJob(stale, { resume: true });
    expect((await kube.podEnv(`run-${runId}`))?.CLAUDE_CODE_OAUTH_TOKEN).toBe(CRED);
    await acts.deleteJob(stale);
    await acts.deleteRunVolume(stale);
  });

  it('createRunSecretAndJob with resume and no agent fails non-retryably as NoAgentCredential', async () => {
    const runId = await seedRun('x', 'queued');
    await asOwner((c) => c.query('update runs set agent_id = null where id = $1', [runId]));
    const err = await createRunActivities(deps())
      .createRunSecretAndJob(await ctxFor(runId), { resume: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).type).toBe('NoAgentCredential');
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
  });

  it('createRunSecretAndJob with resume and no credential fails non-retryably as NoAgentCredential', async () => {
    const runId = await seedRun('x', 'queued');
    const ctx = await ctxFor(runId);
    const empty = new MemorySecretStore();
    const err = await createRunActivities(deps({ secrets: empty }))
      .createRunSecretAndJob(ctx, { resume: true })
      .catch((e: unknown) => e);
    expect((err as ApplicationFailure).type).toBe('NoAgentCredential');
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
  });
});

describe('transcript lines', () => {
  const tline = (entry: Record<string, unknown>) =>
    `agentdesk: transcript ${Buffer.from(JSON.stringify(entry), 'utf8').toString('base64')}`;
  /** A pod that already exited with 0 after logging `lines` (a new pod: its log starts at line 1). */
  const podLogging = (lines: string[]): KubeGateway =>
    wrapKube({
      getRunPod: async (name) => ({ name, phase: 'Succeeded', pendingSince: null, reason: null, exitCode: 0 }),
      streamLogs: async function* () {
        for (const l of lines) yield l;
      },
      readSecret: async () => ({ x: 'y' }),
    });
  const stored = (runId: string) =>
    withOrg(db, ORG, (tx) =>
      tx
        .select()
        .from(runTranscriptEntries)
        .where(eq(runTranscriptEntries.runId, runId))
        .orderBy(runTranscriptEntries.seq),
    );

  it('are redacted and stored, and not written to run_events', async () => {
    const runId = await seedRun('x', 'starting');
    const ctx = await ctxFor(runId);
    const entry = { id: 'u1:0', kind: 'user', text: `use ${CRED} please` };
    const kube1 = podLogging([
      'agentdesk: session started',
      tline(entry),
      tline({ id: 't1:0', kind: 'tool', tool: 'Bash', text: 'ls' }),
    ]);
    await follow(ctx, deps({ kube: kube1 })).promise;
    const rows = await stored(runId);
    expect(rows.map((r) => [r.seq, r.sourceId, r.kind, r.tool])).toEqual([
      [1, 'u1:0', 'user', null],
      [2, 't1:0', 'tool', 'Bash'],
    ]);
    expect(rows[0]?.text).toContain('***');
    expect(JSON.stringify(rows)).not.toContain(CRED);
    const { events } = await load(runId);
    expect(events.filter((e) => e.type === 'lifecycle').map((e) => e.payload.kind)).toEqual(['session_started']);
    expect(JSON.stringify(events)).not.toContain('transcript');
    expect(JSON.stringify(events)).not.toContain('use ');
  });

  it('a follower retry re-reading the log stores each entry once', async () => {
    const runId = await seedRun('x', 'starting');
    const ctx = await ctxFor(runId);
    const k = podLogging([
      'agentdesk: session started',
      tline({ id: 'a:0', kind: 'agent', text: 'one' }),
      tline({ id: 'b:0', kind: 'agent', text: 'two' }),
    ]);
    await follow(ctx, deps({ kube: k })).promise;
    await follow(ctx, deps({ kube: k }), { lastLine: 0 }).promise;
    expect((await stored(runId)).map((r) => r.sourceId)).toEqual(['a:0', 'b:0']);
  });

  it('a second pod re-sending the same ids stores nothing new', async () => {
    const runId = await seedRun('x', 'starting');
    const ctx = await ctxFor(runId);
    const a = tline({ id: 'a:0', kind: 'agent', text: 'one' });
    const b = tline({ id: 'b:0', kind: 'agent', text: 'two' });
    await follow(ctx, deps({ kube: podLogging(['agentdesk: session started', a, b]) })).promise;
    // The resumed pod's log restarts at line 1 and re-sends both ids (its start flush), plus one new entry.
    const c = tline({ id: 'c:0', kind: 'agent', text: 'three' });
    await follow(ctx, deps({ kube: podLogging(['agentdesk: session started', b, a, c]) }), undefined, { resume: true })
      .promise;
    expect((await stored(runId)).map((r) => [r.seq, r.sourceId])).toEqual([
      [1, 'a:0'],
      [2, 'b:0'],
      [3, 'c:0'],
    ]);
  });

  it('a malformed transcript line is an ordinary text line', async () => {
    const runId = await seedRun('x', 'starting');
    const ctx = await ctxFor(runId);
    const bad = 'agentdesk: transcript !!!not-base64';
    const result = await follow(ctx, deps({ kube: podLogging(['agentdesk: session started', bad]) })).promise;
    expect(await stored(runId)).toHaveLength(0);
    expect(result.scrollbackTail).toContain(bad);
  });
});
