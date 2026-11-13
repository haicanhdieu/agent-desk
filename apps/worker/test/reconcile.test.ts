import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeKubeGateway,
  buildRunJob,
  buildSetupTestJob,
  parseConfig,
  runJobName,
  runLabels,
  runPodConfigFrom,
  setupTestJobName,
  setupTestLabels,
  type Config,
} from '@agentdesk/core';
import { createDb, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { reconcile, type ReconcileTemporal } from '../src/activities/reconcile.activity';

const ORG = '44444444-4444-4444-8444-444444444444';
const OTHER_ORG = '77777777-7777-4777-8777-777777777777';
const LIMITS = { ttlSeconds: 900, setupTimeoutSeconds: 600 }; // + 600 s grace = 2100 s
let pgx: TestPg;
let db: Db;
let dir: string;
let kube: FakeKubeGateway;
let config: Config;
let projectId: string;

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

async function seedTest(opts: { ended?: boolean } = {}): Promise<string> {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into setup_tests (org_id, project_id, status, script_sha256, started_by, ended_at)
       values ($1, $2, 'running', 'sha', 'u', $3) returning id`,
      [ORG, projectId, opts.ended ? new Date() : null],
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('seed failed');
    return id;
  });
}

async function seedRun(): Promise<string> {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, ticket_number, checkout_ref,
         args, status, trigger_source)
       values ($1, $2, 'fix', 'fix', '7', 'issue', 7, 'main', '', 'running', 'manual') returning id`,
      [ORG, projectId],
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('seed failed');
    return id;
  });
}

/** A setup-test Secret, and its Job unless `withJob` is false. */
async function createSetupTestObjects(id: string, o: { org?: string; withJob?: boolean } = {}): Promise<string> {
  const name = setupTestJobName(id);
  const org = o.org ?? ORG;
  await kube.ensureSecret(
    name,
    { REPO_CLONE_URL: 'https://t@x.invalid/r.git' },
    setupTestLabels({ setupTestId: id, orgId: org, projectId }),
  );
  if (o.withJob !== false) {
    await kube.ensureJob(
      buildSetupTestJob({
        setupTestId: id,
        orgId: org,
        projectId,
        image: 'img',
        checkoutRef: 'main',
        script: '',
        pluginMarketplaces: {},
        setupTimeoutSeconds: 600,
        ttlSeconds: 900,
        botName: 'bot',
        botEmail: 'bot@example.test',
        pod: runPodConfigFrom(config),
      }),
    );
  }
  return name;
}

const exists = async (name: string): Promise<{ job: boolean; secret: boolean }> => ({
  job: (await kube.getRunPod(name)) !== null,
  secret: (await kube.readSecret(name)) !== null,
});

const noTemporal = (open: Set<string> = new Set()): ReconcileTemporal => ({
  isWorkflowOpen: async (id) => open.has(id),
  listOpenGateProjectIds: async () => [],
  gateRuns: async () => [],
  releaseSlot: async () => undefined,
});

const run = (clock?: { now(): Date }, open?: Set<string>) =>
  reconcile({ db, kube, temporal: noTemporal(open), setupTest: LIMITS, ...(clock ? { clock } : {}) });

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  dir = await mkdtemp(join(tmpdir(), 'reconcile-'));
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
    RUNNER_IMAGE: 'img',
    ENABLE_FAKE_PROVIDER: 'true',
    FAKE_STATE_DIR: join(dir, 'fake'),
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
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id, max_concurrent_runs)
       values ($1, 'demo', 'dev/demo', $2, $2, 3) returning id`,
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

describe('reconcile: setup tests', () => {
  it('deletes orphaned setup test job (and its secret) whose test row is missing', async () => {
    const orphan = await createSetupTestObjects(randomUUID());
    const out = await run();
    expect(await exists(orphan)).toEqual({ job: false, secret: false });
    expect(out.deletedSetupTestJobs).toBeGreaterThanOrEqual(1);
  });

  it('deletes a Job and Secret whose test has ended, keeps a live young one', async () => {
    const endedId = await seedTest({ ended: true });
    const liveId = await seedTest();
    const ended = await createSetupTestObjects(endedId);
    const live = await createSetupTestObjects(liveId);
    await run();
    expect(await exists(ended)).toEqual({ job: false, secret: false });
    expect(await exists(live)).toEqual({ job: true, secret: true });
    await kube.deleteJob(live);
    await kube.deleteSecret(live);
  });

  it('deletes a Job and Secret older than created_at + ttl + setup timeout + 600 s', async () => {
    const id = await seedTest();
    const name = await createSetupTestObjects(id);
    const created = await asOwner((c) =>
      c.query<{ t: Date }>(`select created_at as t from setup_tests where id = $1`, [id]),
    );
    const createdAt = created.rows[0]?.t.getTime() ?? 0;
    // Just inside the limit (2100 s): kept. Just beyond: deleted.
    await run({ now: () => new Date(createdAt + 2099 * 1000) });
    expect(await exists(name)).toEqual({ job: true, secret: true });
    await run({ now: () => new Date(createdAt + 2101 * 1000) });
    expect(await exists(name)).toEqual({ job: false, secret: false });
  });

  it('deletes a Secret whose Job never existed when its test is missing, ended or too old; keeps a young live one', async () => {
    const missing = await createSetupTestObjects(randomUUID(), { withJob: false });
    const ended = await createSetupTestObjects(await seedTest({ ended: true }), { withJob: false });
    const youngId = await seedTest();
    const young = await createSetupTestObjects(youngId, { withJob: false });
    const out = await run();
    expect(await exists(missing)).toEqual({ job: false, secret: false });
    expect(await exists(ended)).toEqual({ job: false, secret: false });
    expect(await exists(young)).toEqual({ job: false, secret: true });
    expect(out.deletedSetupTestSecrets).toBeGreaterThanOrEqual(2);
    expect(out.deletedSetupTestJobs).toBe(0);
    await run({ now: () => new Date(Date.now() + 3600 * 1000) });
    expect(await exists(young)).toEqual({ job: false, secret: false });
  });

  it('a label naming another org never matches the test (looked up under its own org)', async () => {
    const id = await seedTest();
    const name = await createSetupTestObjects(id, { org: OTHER_ORG });
    await run();
    expect(await exists(name)).toEqual({ job: false, secret: false }); // not found under OTHER_ORG: deleted
  });

  it('leaves run Jobs and Secrets to the run step: a live run stays, setup-test cleanup never touches it', async () => {
    const runId = await seedRun();
    const name = runJobName(runId);
    const labels = runLabels({ runId, orgId: ORG, projectId });
    await kube.ensureSecret(name, { REPO_CLONE_URL: 'https://t@x.invalid/r.git' }, labels);
    await kube.ensureJob(
      buildRunJob({
        runId,
        orgId: ORG,
        projectId,
        image: 'img',
        prompt: 'x',
        checkoutRef: 'main',
        cloneUrlSecretKey: 'REPO_CLONE_URL',
        maxTurns: null,
        timeoutSeconds: 600,
        botName: 'bot',
        botEmail: 'bot@example.test',
        pluginMarketplaces: {},
        setupTimeoutSeconds: 600,
        setupScript: null,
        pod: runPodConfigFrom(config),
      }),
    );
    // An old clock would delete any setup-test object; the run object is not one.
    await run({ now: () => new Date(Date.now() + 24 * 3600 * 1000) }, new Set([`run-${runId}`]));
    expect(await exists(name)).toEqual({ job: true, secret: true });
    await kube.deleteJob(name);
    await kube.deleteSecret(name);
  });
});
