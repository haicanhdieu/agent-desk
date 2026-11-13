import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { ApplicationFailure } from '@temporalio/common';
import { MockActivityEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeKubeGateway,
  createAdapterRegistry,
  parseConfig,
  setupTestJobName,
  type Config,
  type KubeGateway,
  type RunPod,
} from '@agentdesk/core';
import { createDb, setupTestEvents, setupTests, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { POD_PENDING_TIMEOUT } from '../src/activities/run.activities';
import type { SetupTestRef } from '../src/activities/setup-test.activities';
import { createSetupTestActivities, type SetupTestActivityDeps } from '../src/activities/setup-test.activities.impl';

const ORG = '44444444-4444-4444-8444-444444444444';
const SCRIPT = 'echo "super-secret-script-body"\nmake setup';
const CLONE_TOKEN = 'fake-workspace-token';
let pgx: TestPg;
let db: Db;
let dir: string;
let projectId: string;
let kube: FakeKubeGateway;
let config: Config;

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

async function seedTest(script: string | null = SCRIPT, status = 'queued'): Promise<SetupTestRef> {
  const id = await asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into setup_tests (org_id, project_id, status, script_sha256, script_body, started_by)
       values ($1, $2, $3, 'sha', $4, 'user-1') returning id`,
      [ORG, projectId, status, script],
    );
    const v = r.rows[0]?.id;
    if (!v) throw new Error('seed failed');
    return v;
  });
  return { orgId: ORG, setupTestId: id };
}

function deps(over: Partial<SetupTestActivityDeps> = {}): SetupTestActivityDeps {
  return {
    db,
    kube,
    adapters: createAdapterRegistry(config, { now: () => new Date() }),
    clock: { now: () => new Date() },
    config,
    timing: { pollMs: 50, heartbeatMs: 200 },
    ...over,
  };
}

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
    listSetupTestJobs: () => kube.listSetupTestJobs(),
    listRunSecrets: () => kube.listRunSecrets(),
    listSetupTestSecrets: () => kube.listSetupTestSecrets(),
    ...over,
  };
}

/** A gateway whose pod logs `lines`, then ends with `exitCode` (null: the pod keeps running after the stream ends). */
function scriptedKube(lines: string[], exitCode: number | null = 1, secret: Record<string, string> | null = null) {
  const calls = { streams: 0 };
  const pod = (name: string): RunPod => ({
    name,
    phase: exitCode === null ? 'Running' : 'Failed',
    pendingSince: null,
    reason: null,
    exitCode,
  });
  const gw = wrapKube({
    getRunPod: async (n) => pod(n),
    readSecret: async () => secret,
    async *streamLogs() {
      calls.streams += 1;
      for (const l of lines) yield l;
    },
  });
  return { gw, calls };
}

const load = (ref: SetupTestRef) =>
  withOrg(db, ORG, async (tx) => {
    const [test] = await tx.select().from(setupTests).where(eq(setupTests.id, ref.setupTestId));
    const events = await tx
      .select()
      .from(setupTestEvents)
      .where(eq(setupTestEvents.setupTestId, ref.setupTestId))
      .orderBy(setupTestEvents.seq);
    return { test, events };
  });

const kinds = (events: { type: string; payload: Record<string, unknown> }[]): unknown[] =>
  events.filter((e) => e.type === 'lifecycle').map((e) => e.payload.kind);

function follow(d: SetupTestActivityDeps, ref: SetupTestRef, heartbeatDetails?: unknown) {
  const env = new MockActivityEnvironment(heartbeatDetails === undefined ? {} : { heartbeatDetails });
  const beats: unknown[] = [];
  env.on('heartbeat', (b: unknown) => beats.push(b));
  const acts = createSetupTestActivities(d);
  return { env, beats, promise: env.run(acts.followSetupTestLogs, ref) };
}

const SHA = 'a'.repeat(40);
const GOOD_LINES = [
  `agentdesk: checkout ${SHA}`,
  'agentdesk: plugins begin',
  'plugin| fetching marketplace',
  'agentdesk: plugin installed superpowers@claude-plugins-official',
  'agentdesk: plugin skipped evil@unapproved (store not approved)',
  'agentdesk: plugin failed broken@claude-plugins-official',
  'agentdesk: plugins end',
  'agentdesk: setup begin',
  'setup| installing deps',
  'agentdesk: setup passed',
  'agentdesk: session started',
];

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  dir = await mkdtemp(join(tmpdir(), 'setup-test-acts-'));
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
    SETUP_TEST_TTL_SECONDS: '120',
  });
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
      `insert into projects (org_id, name, repo_path, default_branch, code_connection_id, board_connection_id,
         max_concurrent_runs)
       values ($1, 'demo', 'dev/demo', 'trunk', $2, $2, 3) returning id`,
      [ORG, conn.rows[0]?.id],
    );
    return proj.rows[0]?.id ?? '';
  });
}, 180_000);

afterAll(async () => {
  await kube?.killAll();
  await db?.close();
  await pgx?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('createSetupTestJob', () => {
  it('test pod env has no agent credential; the Secret holds the clone URL and runEnv only', async () => {
    const ref = await seedTest();
    const acts = createSetupTestActivities(deps());
    const out = await acts.createSetupTestJob(ref);
    // Idempotent: a retry does not start a second pod.
    await Promise.all([acts.createSetupTestJob(ref), acts.createSetupTestJob(ref)]);
    const name = setupTestJobName(ref.setupTestId);
    expect(out).toEqual({ ttlSeconds: 120 });
    expect(await kube.readSecret(name)).toEqual({
      REPO_CLONE_URL: 'https://fake.invalid/dev/demo.git',
      GH_TOKEN: CLONE_TOKEN,
    });
    expect((await kube.processIds()).filter((p) => p.jobName === name)).toHaveLength(1);
    const env = await kube.podEnv(name);
    expect(env).toBeDefined();
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).toMatchObject({ RUN_MODE: 'setup_test', CHECKOUT_REF: 'trunk', SETUP_SCRIPT: SCRIPT });
    expect(await kube.listSetupTestSecrets()).toContainEqual({
      secretName: name,
      setupTestId: ref.setupTestId,
      orgId: ORG,
      projectId,
    });
    const { test, events } = await load(ref);
    expect(test?.status).toBe('running');
    expect(events.filter((e) => e.type === 'status').map((e) => e.payload.status)).toEqual(['running']);
    // The script and the token never land in the database events.
    expect(JSON.stringify(events)).not.toContain('super-secret-script-body');
    expect(JSON.stringify(events)).not.toContain(CLONE_TOKEN);
    await acts.finalizeSetupTest(ref);
  });

  it('does nothing for a test that already ended', async () => {
    const ref = await seedTest(SCRIPT, 'ended');
    const acts = createSetupTestActivities(deps());
    expect(await acts.createSetupTestJob(ref)).toEqual({ ttlSeconds: 120 });
    expect(await kube.getRunPod(setupTestJobName(ref.setupTestId))).toBeNull();
    expect(await kube.readSecret(setupTestJobName(ref.setupTestId))).toBeNull();
  });

  it('a missing test fails non-retryably; a Job failure removes the Secret and leaks no script text', async () => {
    const acts = createSetupTestActivities(deps());
    const missing = await acts
      .createSetupTestJob({ orgId: ORG, setupTestId: '99999999-9999-4999-8999-999999999999' })
      .catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ApplicationFailure);
    expect((missing as ApplicationFailure).nonRetryable).toBe(true);

    const ref = await seedTest();
    const failing = wrapKube({
      ensureJob: async () => {
        throw new Error(`apply failed for ${SCRIPT} with ${CLONE_TOKEN}`);
      },
    });
    const err = await createSetupTestActivities(deps({ kube: failing }))
      .createSetupTestJob(ref)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    const message = (err as ApplicationFailure).message;
    expect(message).not.toContain('super-secret-script-body');
    expect(message).not.toContain(CLONE_TOKEN);
    expect(await kube.readSecret(setupTestJobName(ref.setupTestId))).toBeNull();
  });
});

describe('followSetupTestLogs', () => {
  it('records plugins and checkout', async () => {
    const ref = await seedTest();
    const { gw } = scriptedKube(GOOD_LINES, null);
    const out = await follow(deps({ kube: gw }), ref).promise;
    expect(out).toEqual({ status: 'passed' });
    const { test, events } = await load(ref);
    expect(test).toMatchObject({
      status: 'passed',
      exitCode: null,
      checkoutSha: SHA,
      plugins: {
        installed: ['superpowers@claude-plugins-official'],
        skipped: ['evil@unapproved'],
        failed: ['broken@claude-plugins-official'],
      },
    });
    expect(test?.finishedAt).toBeInstanceOf(Date);
    expect(kinds(events)).toEqual([
      'checkout',
      'plugins_begin',
      'plugin_output',
      'plugin_installed',
      'plugin_skipped',
      'plugin_failed',
      'plugins_end',
      'setup_begin',
      'setup_output',
      'setup_passed',
    ]);
    expect(events.filter((e) => e.type === 'status').map((e) => e.payload.status)).toEqual(['passed']);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });

  it('passes on a real fake pod (no script: setup skipped) and returns without waiting for the pod to exit', async () => {
    const ref = await seedTest(null);
    const acts = createSetupTestActivities(deps());
    await acts.createSetupTestJob(ref);
    const out = await follow(deps(), ref).promise;
    expect(out).toEqual({ status: 'passed' });
    // The idle shell is still running.
    expect((await kube.getRunPod(setupTestJobName(ref.setupTestId)))?.exitCode).toBeNull();
    expect(kinds((await load(ref)).events)).toContain('setup_skipped');
    await acts.finalizeSetupTest(ref);
  });

  it('failed setup records exit code', async () => {
    const ref = await seedTest('echo hi --fake-setup-fail');
    const acts = createSetupTestActivities(deps());
    await acts.createSetupTestJob(ref);
    const out = await follow(deps(), ref).promise;
    expect(out).toEqual({ status: 'failed' });
    const { test } = await load(ref);
    expect(test).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(test?.finishedAt).toBeInstanceOf(Date);
    await acts.finalizeSetupTest(ref);
  });

  it('a timed out setup is failed with no exit code', async () => {
    const ref = await seedTest();
    const { gw } = scriptedKube(
      [`agentdesk: checkout ${SHA}`, 'agentdesk: setup begin', 'agentdesk: setup timed out'],
      null,
    );
    expect(await follow(deps({ kube: gw }), ref).promise).toEqual({ status: 'failed' });
    expect((await load(ref)).test).toMatchObject({ status: 'failed', exitCode: null });
  });

  it('a pod that exits before any result marker leaves the status alone (finalize ends it)', async () => {
    const ref = await seedTest(SCRIPT, 'running');
    const { gw } = scriptedKube([`agentdesk: checkout ${SHA}`, 'agentdesk: setup begin', 'setup| partial'], 137);
    expect(await follow(deps({ kube: gw }), ref).promise).toBeNull();
    const before = await load(ref);
    expect(before.test).toMatchObject({ status: 'running', finishedAt: null });
    expect(before.events.filter((e) => e.type === 'status')).toEqual([]);
    expect(kinds(before.events)).toEqual(['checkout', 'setup_begin', 'setup_output']); // partial output was flushed
    await createSetupTestActivities(deps({ kube: gw })).finalizeSetupTest(ref);
    expect((await load(ref)).test?.status).toBe('ended');
  });

  it('re-attaches when the log stream drops while the pod still runs', async () => {
    const ref = await seedTest();
    let attaches = 0;
    const base = scriptedKube([], null).gw;
    const gw = wrapKube({
      getRunPod: (n) => base.getRunPod(n),
      readSecret: async () => null,
      async *streamLogs() {
        attaches += 1;
        yield `agentdesk: checkout ${SHA}`;
        yield 'agentdesk: setup begin';
        if (attaches > 1) yield 'agentdesk: setup passed';
      },
    });
    expect(await follow(deps({ kube: gw }), ref).promise).toEqual({ status: 'passed' });
    expect(attaches).toBe(2);
    const { test, events } = await load(ref);
    expect(test?.checkoutSha).toBe(SHA);
    expect(kinds(events)).toEqual(['checkout', 'setup_begin', 'setup_passed']); // no duplicates across passes
  });

  it('stores no secret value: output and markers are redacted before they reach an event', async () => {
    const ref = await seedTest();
    const url = 'https://x-access-token:ghs_SUPERSECRETTOKEN123@example.test/dev/demo.git';
    const { gw } = scriptedKube(
      [
        'agentdesk: setup begin',
        `setup| cloning ${url}`,
        'setup| token is ghs_SUPERSECRETTOKEN123 and ghs_SUPERSEC',
        'agentdesk: setup passed',
      ],
      null,
      { REPO_CLONE_URL: url, GH_TOKEN: 'ghs_SUPERSECRETTOKEN123' },
    );
    await follow(deps({ kube: gw }), ref).promise;
    const dump = JSON.stringify(await load(ref));
    expect(dump).not.toContain('ghs_SUPERSECRETTOKEN123');
    expect(dump).not.toContain('SUPERSECRETTOKEN');
    expect(dump).toContain('cloning');
  });

  it('replay and retry add no duplicate events', async () => {
    const ref = await seedTest();
    const { gw } = scriptedKube(GOOD_LINES, null);
    await follow(deps({ kube: gw }), ref).promise;
    const first = await load(ref);
    // The same log read again from the start (a retry that lost its heartbeat, with the result row reset).
    await asOwner((c) =>
      c.query(`update setup_tests set status = 'running', finished_at = null where id = $1`, [ref.setupTestId]),
    );
    await follow(deps({ kube: gw }), ref).promise;
    const second = await load(ref);
    expect(kinds(second.events)).toEqual(kinds(first.events));
    expect(second.events.filter((e) => e.type === 'lifecycle')).toHaveLength(
      first.events.filter((e) => e.type === 'lifecycle').length,
    );
    expect(second.test?.status).toBe('passed');
    // Two concurrent followers (a retry racing its predecessor) also stay unique.
    const ref2 = await seedTest();
    await Promise.all([follow(deps({ kube: gw }), ref2).promise, follow(deps({ kube: gw }), ref2).promise]);
    const { events } = await load(ref2);
    expect(kinds(events).filter((k) => k === 'setup_passed')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'status')).toHaveLength(1);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });

  it('resumes after the last durable line from its heartbeat, taking the summary from stored events', async () => {
    const ref = await seedTest();
    const { gw } = scriptedKube(GOOD_LINES, null);
    const first = follow(deps({ kube: gw }), ref);
    await first.promise;
    expect(first.beats.length).toBeGreaterThan(0);
    expect(first.beats.at(-1)).toMatchObject({ lastLine: GOOD_LINES.indexOf('agentdesk: setup passed') + 1 });
    const before = (await load(ref)).events.filter((e) => e.type === 'lifecycle');
    // The attempt died after line 7 ("plugins end") became durable but before the result was written.
    await asOwner((c) =>
      c.query(
        `update setup_tests set status = 'running', finished_at = null, checkout_sha = null,
           plugins = '{"installed":[],"skipped":[],"failed":[]}' where id = $1`,
        [ref.setupTestId],
      ),
    );
    const out = await follow(deps({ kube: gw }), ref, { lastLine: 7 }).promise;
    expect(out).toEqual({ status: 'passed' });
    const { test, events } = await load(ref);
    expect(events.filter((e) => e.type === 'lifecycle')).toHaveLength(before.length);
    expect(test?.checkoutSha).toBe(SHA); // line 1 was skipped on this attempt; the summary comes from storage
    expect(test?.plugins.installed).toEqual(['superpowers@claude-plugins-official']);
  });

  it('returns the stored result at once when the test already has one', async () => {
    const ref = await seedTest(SCRIPT, 'failed');
    const { gw, calls } = scriptedKube([], null);
    expect(await follow(deps({ kube: gw }), ref).promise).toEqual({ status: 'failed' });
    expect(calls.streams).toBe(0);
  });

  it('a pod that never starts fails non-retryably after the pending limit', async () => {
    const ref = await seedTest();
    const gw = wrapKube({
      getRunPod: async () => null,
      readSecret: async () => null,
    });
    const err = await follow(
      deps({ kube: gw, timing: { pollMs: 10, heartbeatMs: 200, pendingLimitMs: 50 } }),
      ref,
    ).promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect((err as ApplicationFailure).type).toBe(POD_PENDING_TIMEOUT); // same typed failure as the run path
  });
});

describe('finalizeSetupTest', () => {
  it('finalize clears script_body, removes the Job and Secret and ends a test with no result', async () => {
    const ref = await seedTest();
    const acts = createSetupTestActivities(deps());
    await acts.createSetupTestJob(ref);
    const name = setupTestJobName(ref.setupTestId);
    expect(await kube.getRunPod(name)).not.toBeNull();
    await acts.finalizeSetupTest(ref);
    await acts.finalizeSetupTest(ref); // idempotent
    expect(await kube.getRunPod(name)).toBeNull();
    expect(await kube.readSecret(name)).toBeNull();
    const { test, events } = await load(ref);
    expect(test?.scriptBody).toBeNull();
    expect(test?.status).toBe('ended');
    expect(test?.endedAt).toBeInstanceOf(Date);
    expect(events.filter((e) => e.type === 'status').map((e) => e.payload.status)).toEqual(['running', 'ended']);
  });

  it('keeps a recorded result and works when nothing was ever created', async () => {
    const ref = await seedTest(SCRIPT, 'passed');
    await createSetupTestActivities(deps()).finalizeSetupTest(ref);
    const { test, events } = await load(ref);
    expect(test).toMatchObject({ status: 'passed', scriptBody: null });
    expect(test?.endedAt).toBeInstanceOf(Date);
    expect(events.filter((e) => e.type === 'status')).toEqual([]);
    // A missing test is not an error either.
    await createSetupTestActivities(deps()).finalizeSetupTest({
      orgId: ORG,
      setupTestId: '99999999-9999-4999-8999-999999999999',
    });
  });
});
