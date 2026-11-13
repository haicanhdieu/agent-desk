import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeKubeGateway,
  FakeStore,
  MemorySecretStore,
  SIGNAL,
  TASK_QUEUE,
  WORKFLOW,
  createAdapterRegistry,
  parseConfig,
  runWorkflowId,
  systemClock,
} from '@agentdesk/core';
import { createDb, runEvents, runs, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import { createActivities } from '../src/activities';
import { reconcile } from '../src/activities/reconcile.activity';
import { pollScheduleOps } from '../src/activities/poll-ops';
import { temporalOps } from '../src/activities/temporal-ops';

// End to end in one process: real RunWorkflow + gate bundle on the local Temporal dev server, the real activities,
// Postgres (Testcontainers), the fake kube gateway (child-process pods) and the fake provider.
const ORG = '88888888-8888-4888-8888-888888888888';
const AGENT = '99999999-9999-4999-8999-999999999999';
let env: TestWorkflowEnvironment;
let pgx: TestPg;
let db: Db;
let dir: string;
let projectId: string;
let kube: FakeKubeGateway;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(50);
  }
}

beforeAll(async () => {
  [env, pgx] = await Promise.all([TestWorkflowEnvironment.createLocal(), startPg()]);
  db = createDb(pgx.appUrl);
  dir = await mkdtemp(join(tmpdir(), 'run-e2e-'));
  kube = new FakeKubeGateway(join(dir, 'kube'), { turnMs: 200 });
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  await c.query(`insert into organization (id, name, slug, created_at) values ($1, 'E2E', 'e2e', now())`, [ORG]);
  await c.query('begin');
  await c.query(`select set_config('app.org_id', $1, true)`, [ORG]);
  const conn = await c.query<{ id: string }>(
    `insert into connections (org_id, provider, capabilities, external_id, account_name)
     values ($1, 'fake', '{"code":true,"board":true}', $2, 'dev') returning id`,
    [ORG, `fake-${ORG}`],
  );
  const proj = await c.query<{ id: string }>(
    `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
     values ($1, 'demo', 'dev/demo', $2, $2) returning id`,
    [ORG, conn.rows[0]?.id],
  );
  projectId = proj.rows[0]?.id ?? '';
  await c.query(
    `insert into agents (id, org_id, project_id, name, model, credential_secret_name, credential_type)
     values ($1, $2, $3, 'claude', 'sonnet', $4, 'api_key')`,
    [AGENT, ORG, projectId, `org-${ORG}-agent-${AGENT}`],
  );
  await c.query('commit');
  await c.end();
}, 240_000);

afterAll(async () => {
  await kube?.killAll();
  await env?.teardown();
  await db?.close();
  await pgx?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('RunWorkflow end to end (KUBE_MODE=fake, fake provider)', () => {
  it('queued → starting → running → idle → finish → succeeded, with start and finish comments', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:5173',
      DATABASE_APP_URL: 'x',
      DATABASE_OWNER_URL: 'x',
      DATABASE_ADMIN_URL: 'x',
      TEMPORAL_ADDRESS: 'x',
      TEMPORAL_NAMESPACE: 'default',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      RUNNER_IMAGE: 'runner:test',
      ENABLE_FAKE_PROVIDER: 'true',
      FAKE_STATE_DIR: join(dir, 'fake'),
    });
    const secrets = new MemorySecretStore();
    await secrets.put(`org-${ORG}-agent-${AGENT}`, { type: 'api_key', value: 'sk-ant-api03-e2e-secret-value' });
    const ops = temporalOps(env.client);
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL('../src/workflows/index.ts', import.meta.url)),
      activities: createActivities({
        db,
        starter: env.client.workflow,
        gate: env.client.workflow,
        kube,
        adapters: createAdapterRegistry(config, systemClock),
        secrets,
        signaller: ops,
        temporal: ops,
        pollSchedules: pollScheduleOps(env.client),
        clock: systemClock,
        config,
        timing: { pollMs: 100 },
      }),
    });

    const runId = await withOrg(db, ORG, async (tx) => {
      const [r] = await tx
        .insert(runs)
        .values({
          orgId: ORG,
          projectId,
          agentId: AGENT,
          command: 'fix',
          skillName: 'fix',
          ticketRef: '3',
          ticketKind: 'issue',
          ticketNumber: 3,
          checkoutRef: 'main',
          args: 'make it work',
          triggerSource: 'manual',
        })
        .returning({ id: runs.id });
      if (!r) throw new Error('insert failed');
      return r.id;
    });

    await worker.runUntil(async () => {
      const handle = await env.client.workflow.start(WORKFLOW.run, {
        taskQueue: TASK_QUEUE,
        workflowId: runWorkflowId(runId),
        args: [{ orgId: ORG, runId }],
      });
      await until(async () => {
        const [r] = await withOrg(db, ORG, (tx) => tx.select().from(runs).where(eq(runs.id, runId)));
        return r?.status === 'idle';
      });
      // Wait until the workflow itself has seen the turn end, then finish the run.
      await until(async () => (await handle.query<{ phase: string }>('state')).phase === 'idle');
      await handle.signal(SIGNAL.finish);
      expect(await handle.result()).toMatchObject({ status: 'succeeded', exitCode: 0 });

      // Reconcile against the real server: the gate is open and holds no dead runs.
      expect(
        await reconcile({ db, kube, temporal: ops, setupTest: { ttlSeconds: 900, setupTimeoutSeconds: 600 } }),
      ).toEqual({
        deletedJobs: 1,
        deletedSecrets: 0,
        releasedSlots: 0,
        deletedSetupTestJobs: 0,
        deletedSetupTestSecrets: 0,
      });
    });

    const { run, events } = await withOrg(db, ORG, async (tx) => ({
      run: (await tx.select().from(runs).where(eq(runs.id, runId)))[0],
      events: await tx.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq),
    }));
    expect(run?.status).toBe('succeeded');
    expect(events.filter((e) => e.type === 'status').map((e) => e.payload.status)).toEqual([
      'starting',
      'running',
      'idle',
      'succeeded',
    ]);
    expect(events.filter((e) => e.type === 'scrollback')).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('sk-ant-api03-e2e-secret-value');
    const posted = (await new FakeStore(config.FAKE_STATE_DIR).listPosted()).filter((p) => p.ticketRef === '3');
    expect(posted).toHaveLength(2);
    expect(posted[1]?.body).toContain('succeeded');
    expect(await kube.readSecret(`run-${runId}`)).toBeNull();
    expect(await kube.listRunJobs()).toEqual([]); // the finished Job was removed by reconcile
  });
});
