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
  runVolumeName,
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
        gitUsername: 'x-access-token',
        gitHost: 'fake.invalid',
        cliTokenEnvName: 'GH_TOKEN',
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
        credentialEnvKeys: [],
        gitUsername: 'x-access-token',
        gitHost: 'fake.invalid',
        cliTokenEnvName: 'GH_TOKEN',
        maxTurns: null,
        deadlineSeconds: 600,
        resume: false,
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

interface SeedVolumeRun {
  status: string;
  sessionExpiresAt?: Date | null;
}

async function seedRunWith(o: SeedVolumeRun): Promise<string> {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, ticket_number, checkout_ref,
         args, status, trigger_source, session_expires_at, paused_at, finished_at)
       values ($1, $2, 'fix', 'fix', '7', 'issue', 7, 'main', '', $3, 'manual', $4, $5, $6) returning id`,
      [
        ORG,
        projectId,
        o.status,
        o.sessionExpiresAt ?? null,
        o.status === 'paused' ? new Date() : null,
        ['succeeded', 'expired'].includes(o.status) ? new Date() : null,
      ],
    );
    const id = r.rows[0]?.id;
    if (!id) throw new Error('seed failed');
    return id;
  });
}

const volumeNames = async (): Promise<string[]> => (await kube.listRunVolumeClaims()).map((v) => v.name);
const addVolume = (runId: string): Promise<void> =>
  kube.ensureVolumeClaim(runVolumeName(runId), { size: '1Gi' }, runLabels({ runId, orgId: ORG, projectId }));
const rowOf = async (id: string): Promise<{ status: string; session_expires_at: Date | null }> =>
  asOwner(async (c) => {
    const r = await c.query<{ status: string; session_expires_at: Date | null }>(
      `select status, session_expires_at from runs where id = $1`,
      [id],
    );
    const row = r.rows[0];
    if (!row) throw new Error('missing');
    return row;
  });
const inFuture = (s: number): Date => new Date(Date.now() + s * 1000);
const openSet = (id: string): Set<string> => new Set([`run-${id}`]);

describe('reconcile: run volumes', () => {
  it('deletes the volume of a run that does not exist', async () => {
    const id = randomUUID();
    await addVolume(id);
    const out = await run();
    expect(await volumeNames()).not.toContain(runVolumeName(id));
    expect(out.deletedVolumes).toBeGreaterThanOrEqual(1);
  });

  it('deletes the volume of a settled run (final, no kept session)', async () => {
    const id = await seedRunWith({ status: 'failed' });
    await addVolume(id);
    await run(undefined, openSet(id));
    expect(await volumeNames()).not.toContain(runVolumeName(id));
  });

  it('keeps the volume of a succeeded run whose kept session has not expired', async () => {
    const id = await seedRunWith({ status: 'succeeded', sessionExpiresAt: inFuture(7200) });
    await addVolume(id);
    await run(undefined, openSet(id));
    expect(await volumeNames()).toContain(runVolumeName(id));
    await kube.deleteVolumeClaim(runVolumeName(id));
  });

  it('deletes the volume when the session expired more than 3600 s ago, keeps it inside the grace', async () => {
    const expires = new Date(Date.now() + 10_000_000);
    const id = await seedRunWith({ status: 'paused', sessionExpiresAt: expires });
    await addVolume(id);
    await run({ now: () => new Date(expires.getTime() + 3599 * 1000) }, openSet(id));
    expect(await volumeNames()).toContain(runVolumeName(id));
    await run({ now: () => new Date(expires.getTime() + 3601 * 1000) }, openSet(id));
    expect(await volumeNames()).not.toContain(runVolumeName(id));
  });

  it('deletes the volume of a running run whose workflow is closed', async () => {
    const id = await seedRunWith({ status: 'running' });
    await addVolume(id);
    await run(); // no open workflows
    expect(await volumeNames()).not.toContain(runVolumeName(id));
  });

  it('keeps the volume of a running run with an open workflow', async () => {
    const id = await seedRunWith({ status: 'running' });
    await addVolume(id);
    await run(undefined, openSet(id));
    expect(await volumeNames()).toContain(runVolumeName(id));
    await kube.deleteVolumeClaim(runVolumeName(id));
  });

  it('keeps the volume of a paused run with an open workflow and a future expiry', async () => {
    const id = await seedRunWith({ status: 'paused', sessionExpiresAt: inFuture(7200) });
    await addVolume(id);
    const out = await run(undefined, openSet(id));
    expect(await volumeNames()).toContain(runVolumeName(id));
    expect((await rowOf(id)).status).toBe('paused');
    expect(out.expiredRuns).toBe(0);
    await kube.deleteVolumeClaim(runVolumeName(id));
  });

  it('writes a paused run with a closed workflow as expired and deletes its volume', async () => {
    const id = await seedRunWith({ status: 'paused', sessionExpiresAt: inFuture(7200) });
    await addVolume(id);
    const out = await run();
    const row = await rowOf(id);
    expect(row.status).toBe('expired');
    expect(row.session_expires_at).toBeNull();
    expect(await volumeNames()).not.toContain(runVolumeName(id));
    expect(out.expiredRuns).toBeGreaterThanOrEqual(1);
  });

  it('clears the kept session of a succeeded run whose workflow is closed, and deletes its volume', async () => {
    const id = await seedRunWith({ status: 'succeeded', sessionExpiresAt: inFuture(7200) });
    await addVolume(id);
    await run();
    const row = await rowOf(id);
    expect(row.status).toBe('succeeded');
    expect(row.session_expires_at).toBeNull();
    expect(await volumeNames()).not.toContain(runVolumeName(id));
  });

  it('logs a failed volume delete by error name only and still processes the next volume', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await addVolume(a);
    await addVolume(b);
    const warnings: { msg: string; meta?: Record<string, unknown> }[] = [];
    const failing = new Proxy(kube, {
      get(target, prop, receiver) {
        if (prop === 'deleteVolumeClaim') {
          return async (name: string) => {
            if (name === runVolumeName(a)) throw new Error('secret-ish detail');
            await target.deleteVolumeClaim(name);
          };
        }
        const v: unknown = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    await reconcile({
      db,
      kube: failing,
      temporal: noTemporal(),
      setupTest: LIMITS,
      log: { warn: (msg, meta) => void warnings.push({ msg, ...(meta ? { meta } : {}) }) },
    });
    const names = await volumeNames();
    expect(names).toContain(runVolumeName(a));
    expect(names).not.toContain(runVolumeName(b));
    expect(JSON.stringify(warnings)).not.toContain('secret-ish');
    expect(warnings.some((w) => w.meta?.error === 'Error')).toBe(true);
    await kube.deleteVolumeClaim(runVolumeName(a));
  });
});
