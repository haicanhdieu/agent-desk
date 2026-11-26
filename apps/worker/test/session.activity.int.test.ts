import pg from 'pg';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeKubeGateway, MemorySecretStore, createAdapterRegistry, parseConfig, type Config } from '@agentdesk/core';
import { createDb, runEvents, runs, withOrg, type Db } from '@agentdesk/db';
import { startPg, type TestPg } from '@agentdesk/db/testing';
import type { RunContext } from '../src/activities/run.activities';
import { setRunStatus } from '../src/activities/run-status.activity';
import { createRunActivities, type RunActivityDeps, type RunSignaller } from '../src/activities/run.activities.impl';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORG = '66666666-6666-4666-8666-666666666666';
const AT = '2026-03-01T10:00:00.000Z';
const atPlus = (s: number): string => new Date(new Date(AT).getTime() + s * 1000).toISOString();
const CRED = 'sk-ant-oat01-SESSION-CREDENTIAL-xyz';

let pgx: TestPg;
let db: Db;
let dir: string;
let kube: FakeKubeGateway;
let config: Config;
let connId: string;
const secrets = new MemorySecretStore();
const signals: { runId: string; signal: string }[] = [];
const signaller: RunSignaller = { signalRun: async (runId, signal) => void signals.push({ runId, signal }) };

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

/** A project with its own agent (keep settings given), so counting rules never see another test's runs. */
async function seedProject(
  keep: { paused?: number; done?: number } = {},
): Promise<{ projectId: string; agentId: string }> {
  return asOwner(async (c) => {
    const proj = await c.query<{ id: string }>(
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id,
         paused_keep_seconds, done_keep_seconds)
       values ($1, $2, $4, $3, $3, $5, $6) returning id`,
      [ORG, `p-${Math.random()}`, connId, `dev/demo-${Math.random()}`, keep.paused ?? 604800, keep.done ?? 86400],
    );
    const projectId = proj.rows[0]?.id ?? '';
    const agent = await c.query<{ id: string }>(
      `insert into agents (org_id, project_id, name, model)
       values ($1, $2, 'claude', 'sonnet') returning id`,
      [ORG, projectId],
    );
    return { projectId, agentId: agent.rows[0]?.id ?? '' };
  });
}

async function seedRun(
  p: { projectId: string; agentId: string | null },
  status: string,
  sessionExpiresAt: string | null = null,
  agentNote: string | null = null,
): Promise<string> {
  return asOwner(async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into runs (org_id, project_id, agent_id, command, skill_name, ticket_ref, ticket_kind, ticket_number,
         checkout_ref, status, trigger_source, session_expires_at, agent_note)
       values ($1, $2, $3, 'fix', 'fix', '7', 'issue', 7, 'main', $4, 'manual', $5, $6) returning id`,
      [ORG, p.projectId, p.agentId, status, sessionExpiresAt, agentNote],
    );
    return r.rows[0]?.id ?? '';
  });
}

function deps(over: Partial<RunActivityDeps> = {}): RunActivityDeps {
  return {
    db,
    kube,
    adapters: createAdapterRegistry(config, { now: () => new Date() }),
    secrets,
    signaller,
    clock: { now: () => new Date(AT) },
    config,
    ...over,
  };
}
const acts = () => createRunActivities(deps());
const ctxFor = (runId: string): Promise<RunContext> => acts().loadRun(ORG, runId);
const load = (runId: string) =>
  withOrg(db, ORG, async (tx) => {
    const [run] = await tx.select().from(runs).where(eq(runs.id, runId));
    const events = await tx.select().from(runEvents).where(eq(runEvents.runId, runId)).orderBy(runEvents.seq);
    return { run, events };
  });

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  dir = await mkdtemp(join(tmpdir(), 'session-acts-'));
  kube = new FakeKubeGateway(join(dir, 'kube'));
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
  const c = new pg.Client({ connectionString: pgx.ownerUrl });
  await c.connect();
  await c.query(`insert into organization (id, name, slug, created_at) values ($1, 'Acme', 'acme', now())`, [ORG]);
  await c.end();
  connId = await asOwner(async (cl) => {
    const conn = await cl.query<{ id: string }>(
      `insert into connections (org_id, provider, capabilities, external_id, account_name)
       values ($1, 'fake', '{"code":true,"board":true}', $2, 'dev') returning id`,
      [ORG, `fake-${ORG}`],
    );
    return conn.rows[0]?.id ?? '';
  });
}, 180_000);

afterAll(async () => {
  await db?.close();
  await pgx?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  signals.length = 0;
});

describe('parkRun', () => {
  it('needs_input: status paused, expiry = at + the agent pausedKeepSeconds, the note is kept', async () => {
    const p = await seedProject({ paused: 7200 });
    const runId = await seedRun(p, 'idle', null, 'Which database?');
    const result = await acts().parkRun(await ctxFor(runId), { kind: 'needs_input', at: AT, reason: 'idle_timeout' });
    expect(result).toEqual({ status: 'paused', sessionExpiresAt: atPlus(7200) });
    const { run, events } = await load(runId);
    expect(run?.status).toBe('paused');
    expect(run?.sessionExpiresAt?.toISOString()).toBe(atPlus(7200));
    expect(run?.pausedAt?.toISOString()).toBe(AT);
    expect(run?.agentNote).toBe('Which database?');
    expect(events.filter((e) => e.type === 'status').map((e) => e.payload.status)).toEqual(['paused']);
  });

  it('writes the pause reason and clears the ending time, for a paused run and for a kept done run', async () => {
    const p = await seedProject({ paused: 7200, done: 3600 });
    for (const [kind, status, reason] of [
      ['needs_input', 'paused', 'pod_lost'],
      ['done', 'succeeded', 'agent_crashed'],
    ] as const) {
      const runId = await seedRun(p, kind === 'done' ? 'done' : 'idle');
      await asOwner((c) => c.query('update runs set session_ending_at = $2 where id = $1', [runId, AT]));
      await acts().parkRun(await ctxFor(runId), { kind, at: AT, reason });
      const { run } = await load(runId);
      expect(run).toMatchObject({ status, pauseReason: reason, sessionEndingAt: null });
    }
  });

  it('a parkRun input without a reason (scheduled by code from before it existed) is stored as idle_timeout', async () => {
    const p = await seedProject({ paused: 7200 });
    const runId = await seedRun(p, 'idle');
    await acts().parkRun(await ctxFor(runId), { kind: 'needs_input', at: AT });
    expect((await load(runId)).run).toMatchObject({ status: 'paused', pauseReason: 'idle_timeout' });
  });

  it('a resume that made the run live again clears the pause reason; a failed resume keeps it', async () => {
    const p = await seedProject({ paused: 7200 });
    const runId = await seedRun(p, 'idle');
    const ctx = await ctxFor(runId);
    await acts().parkRun(ctx, { kind: 'needs_input', at: AT, reason: 'pod_lost' });
    await acts().restoreParked(ctx, {
      kind: 'needs_input',
      sessionExpiresAt: atPlus(7200),
      reason: 'the pod could not start',
      at: atPlus(10),
    });
    expect((await load(runId)).run?.pauseReason).toBe('pod_lost');
    await setRunStatus(db, { orgId: ORG, runId, status: 'idle', keepAgentNote: true, session: null, at: atPlus(20) });
    expect((await load(runId)).run).toMatchObject({ status: 'idle', pauseReason: null });
  });

  it('done with doneKeepSeconds 0: succeeded and nothing is kept', async () => {
    const p = await seedProject({ done: 0 });
    const runId = await seedRun(p, 'done');
    const result = await acts().parkRun(await ctxFor(runId), { kind: 'done', at: AT, reason: 'idle_timeout' });
    expect(result).toEqual({ status: 'succeeded', sessionExpiresAt: null });
    const { run } = await load(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.sessionExpiresAt).toBeNull();
  });

  it('a resume queued behind the ending finds nothing kept: one resume_failed lifecycle event says so', async () => {
    const p = await seedProject({ done: 0 });
    const runId = await seedRun(p, 'done');
    await acts().parkRun(await ctxFor(runId), { kind: 'done', at: AT, reason: 'idle_timeout', resumeQueued: true });
    const { run, events } = await load(runId);
    expect(run).toMatchObject({ status: 'succeeded', sessionExpiresAt: null });
    expect(events.filter((e) => e.type === 'lifecycle').map((e) => e.payload)).toEqual([
      {
        kind: 'resume_failed',
        reason: 'nothing was kept to resume from',
        text: 'The resume could not run: nothing was kept to resume from.',
      },
    ]);
  });

  it('a resume queued behind the ending with a kept session records no event (the resume runs)', async () => {
    const p = await seedProject({ paused: 7200 });
    const runId = await seedRun(p, 'idle');
    await acts().parkRun(await ctxFor(runId), {
      kind: 'needs_input',
      at: AT,
      reason: 'idle_timeout',
      resumeQueued: true,
    });
    expect((await load(runId)).events.filter((e) => e.type === 'lifecycle')).toEqual([]);
  });

  it('done: succeeded with a kept session of doneKeepSeconds and the summary kept', async () => {
    const p = await seedProject({ done: 3600 });
    const runId = await seedRun(p, 'done', null, 'Opened PR #1');
    const result = await acts().parkRun(await ctxFor(runId), { kind: 'done', at: AT, reason: 'idle_timeout' });
    expect(result).toEqual({ status: 'succeeded', sessionExpiresAt: atPlus(3600) });
    const { run } = await load(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.agentNote).toBe('Opened PR #1');
  });

  it('parkRun with keepUntil in the future stores that deadline, not at + keep seconds', async () => {
    const p = await seedProject({ done: 3600 });
    const runId = await seedRun(p, 'done');
    const result = await acts().parkRun(await ctxFor(runId), {
      kind: 'done',
      at: AT,
      reason: 'idle_timeout',
      keepUntil: atPlus(1200),
    });
    expect(result).toEqual({ status: 'succeeded', sessionExpiresAt: atPlus(1200) });
    expect((await load(runId)).run?.sessionExpiresAt?.toISOString()).toBe(atPlus(1200));
  });

  it('parkRun with a keepUntil that is not after at keeps nothing, never a fresh retention', async () => {
    const p = await seedProject({ done: 3600 });
    for (const keepUntil of [AT, atPlus(-60)]) {
      const runId = await seedRun(p, 'done');
      const result = await acts().parkRun(await ctxFor(runId), {
        kind: 'done',
        at: AT,
        reason: 'idle_timeout',
        keepUntil,
      });
      expect(result).toEqual({ status: 'succeeded', sessionExpiresAt: null });
      expect((await load(runId)).run?.sessionExpiresAt).toBeNull();
    }
  });

  it('parkRun with keepUntil for kind done still applies the per-project cap', async () => {
    const p = await seedProject({ done: 3600 });
    const kept: string[] = [];
    for (let i = 0; i < 10; i++) kept.push(await seedRun(p, 'succeeded', atPlus(1000 + i * 100)));
    const runId = await seedRun(p, 'done');
    await acts().parkRun(await ctxFor(runId), {
      kind: 'done',
      at: AT,
      reason: 'idle_timeout',
      keepUntil: atPlus(1200),
    });
    expect(signals).toEqual([{ runId: kept[0], signal: 'dropSession' }]);
  });

  it('parkRun that closes a reopened session clears the flag, keeps a fresh deadline and records session_closed', async () => {
    const p = await seedProject({ done: 3600 });
    const runId = await seedRun(p, 'done');
    await asOwner((c) => c.query(`update runs set reopened_at = $1 where id = $2`, [AT, runId]));
    const result = await acts().parkRun(await ctxFor(runId), {
      kind: 'done',
      at: AT,
      reason: 'idle_timeout',
      closed: 'idle',
    });
    expect(result).toEqual({ status: 'succeeded', sessionExpiresAt: atPlus(3600) });
    const { run, events } = await load(runId);
    expect(run).toMatchObject({ status: 'succeeded', reopenedAt: null });
    expect(run?.sessionExpiresAt?.toISOString()).toBe(atPlus(3600));
    expect(events.filter((e) => e.type === 'lifecycle').map((e) => e.payload)).toContainEqual({
      kind: 'session_closed',
      how: 'idle',
    });
  });

  it('parkRun rejects an unparseable keepUntil as non-retryable', async () => {
    const p = await seedProject({ done: 3600 });
    const runId = await seedRun(p, 'done');
    await expect(
      acts().parkRun(await ctxFor(runId), { kind: 'done', at: AT, reason: 'idle_timeout', keepUntil: 'nope' }),
    ).rejects.toMatchObject({ nonRetryable: true });
  });

  it('done with 10 kept sessions and the cap at 10: only the oldest kept run is told to drop; paused runs are not counted', async () => {
    const p = await seedProject({ done: 3600 });
    const kept: string[] = [];
    for (let i = 0; i < 10; i++) kept.push(await seedRun(p, 'succeeded', atPlus(1000 + i * 100)));
    // Paused runs expire before every kept one; counting them would pick them first.
    const paused = [await seedRun(p, 'paused', atPlus(10)), await seedRun(p, 'paused', atPlus(20))];
    // A succeeded run whose session is gone or already expired is not a kept session either.
    await seedRun(p, 'succeeded', null);
    await seedRun(p, 'succeeded', atPlus(-5));
    const runId = await seedRun(p, 'done');
    await acts().parkRun(await ctxFor(runId), { kind: 'done', at: AT, reason: 'idle_timeout' });
    expect(signals).toEqual([{ runId: kept[0], signal: 'dropSession' }]);
    expect(signals.map((s) => s.runId)).not.toContain(paused[0]);
  });

  it('done under the cap signals nobody', async () => {
    const p = await seedProject({ done: 3600 });
    for (let i = 0; i < 9; i++) await seedRun(p, 'succeeded', atPlus(1000 + i * 100));
    const runId = await seedRun(p, 'done');
    await acts().parkRun(await ctxFor(runId), { kind: 'done', at: AT, reason: 'idle_timeout' });
    expect(signals).toEqual([]);
  });

  it('with the agent row gone it still uses the project keep times', async () => {
    const p = await seedProject({ paused: 7200, done: 3600 });
    const gone = { projectId: p.projectId, agentId: null };
    const idle = await seedRun(gone, 'idle');
    const done = await seedRun(gone, 'done');
    expect(
      (await acts().parkRun(await ctxFor(idle), { kind: 'needs_input', at: AT, reason: 'idle_timeout' }))
        .sessionExpiresAt,
    ).toBe(atPlus(7200));
    expect(
      (await acts().parkRun(await ctxFor(done), { kind: 'done', at: AT, reason: 'idle_timeout' })).sessionExpiresAt,
    ).toBe(atPlus(3600));
  });
});

describe('endKeptSession', () => {
  it('expired on a paused run: status expired, no session', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'paused', atPlus(100));
    await acts().endKeptSession(await ctxFor(runId), 'expired', atPlus(200));
    const { run } = await load(runId);
    expect(run?.status).toBe('expired');
    expect(run?.sessionExpiresAt).toBeNull();
  });

  it('expired on a succeeded run: stays succeeded, the session is cleared and a status event says so', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'succeeded', atPlus(100));
    await acts().endKeptSession(await ctxFor(runId), 'expired', atPlus(200));
    const { run, events } = await load(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.sessionExpiresAt).toBeNull();
    const last = events.filter((e) => e.type === 'status').at(-1);
    expect(last?.payload).toMatchObject({ status: 'succeeded', sessionExpiresAt: null });
  });

  it('dropped on a succeeded run clears the session too', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'succeeded', atPlus(100));
    await acts().endKeptSession(await ctxFor(runId), 'dropped', atPlus(50));
    const { run } = await load(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.sessionExpiresAt).toBeNull();
  });

  it('dropped on a paused run changes nothing', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'paused', atPlus(100));
    const before = await load(runId);
    await acts().endKeptSession(await ctxFor(runId), 'dropped', atPlus(50));
    const after = await load(runId);
    expect(after.run).toEqual(before.run);
    expect(after.events).toHaveLength(before.events.length);
  });

  it('on a run that no longer exists (its project was deleted) resolves without throwing', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'succeeded', atPlus(100));
    const ctx = await ctxFor(runId);
    await asOwner((c) => c.query('delete from runs where id = $1', [runId]));
    await expect(acts().endKeptSession(ctx, 'dropped', atPlus(50))).resolves.toBeUndefined();
  });

  it('a second call on an already cleared session writes no second event', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'succeeded', atPlus(100));
    await acts().endKeptSession(await ctxFor(runId), 'expired', atPlus(200));
    const n = (await load(runId)).events.length;
    await acts().endKeptSession(await ctxFor(runId), 'expired', atPlus(300));
    expect((await load(runId)).events).toHaveLength(n);
  });
});

describe('restoreParked', () => {
  it('puts a paused run back with the same expiry and stores a redacted, capped resume_failed event', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'starting', atPlus(5000), 'Which database?');
    await secrets.put(`org-${ORG}-agent-${p.agentId}`, { type: 'oauth_token', value: CRED });
    await asOwner((c) =>
      c.query(`update agents set credential_secret_name = $1 where id = $2`, [
        `org-${ORG}-agent-${p.agentId}`,
        p.agentId,
      ]),
    );
    const reason = `pod failed with ${CRED}\nsecond line ${'x'.repeat(2000)}`;
    await acts().restoreParked(await ctxFor(runId), {
      kind: 'needs_input',
      sessionExpiresAt: atPlus(5000),
      reason,
      at: atPlus(60),
    });
    const { run, events } = await load(runId);
    expect(run?.status).toBe('paused');
    expect(run?.sessionExpiresAt?.toISOString()).toBe(atPlus(5000));
    expect(run?.agentNote).toBe('Which database?');
    const ev = events.find((e) => e.type === 'lifecycle' && e.payload.kind === 'resume_failed');
    expect(ev).toBeDefined();
    const text = String(ev?.payload.reason);
    expect(text).not.toContain(CRED);
    expect(text).not.toContain('\n');
    expect(text.length).toBeLessThanOrEqual(500);
  });

  it('a failed resume (paused, queued, starting, restoreParked) leaves paused_at as it was', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'idle', atPlus(5000), 'Which database?');
    const base = { orgId: ORG, runId, keepAgentNote: true };
    await setRunStatus(db, { ...base, status: 'paused', session: { expiresAt: atPlus(5000) }, at: atPlus(10) });
    await setRunStatus(db, { ...base, status: 'queued', at: atPlus(20) });
    await setRunStatus(db, { ...base, status: 'starting', at: atPlus(30) });
    await acts().restoreParked(await ctxFor(runId), {
      kind: 'needs_input',
      sessionExpiresAt: atPlus(5000),
      reason: 'pod failed',
      at: atPlus(60),
    });
    const { run, events } = await load(runId);
    expect(run?.status).toBe('paused');
    expect(run?.pausedAt?.toISOString()).toBe(atPlus(10));
    const last = events.filter((e) => e.type === 'status').at(-1);
    expect(last?.payload).toMatchObject({ status: 'paused', pausedAt: atPlus(10) });
  });

  it('puts a done run back as succeeded with its session', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'queued', atPlus(5000));
    await acts().restoreParked(await ctxFor(runId), {
      kind: 'done',
      sessionExpiresAt: atPlus(5000),
      reason: 'no saved session was found',
      at: atPlus(60),
    });
    const { run, events } = await load(runId);
    expect(run?.status).toBe('succeeded');
    expect(run?.sessionExpiresAt?.toISOString()).toBe(atPlus(5000));
    expect(events.some((e) => e.payload.kind === 'resume_failed')).toBe(true);
  });
});

describe('recordAutoResume', () => {
  const end = { kind: 'killed', exitCode: 137, podReason: 'OOMKilled' } as const;

  it('appends one auto_resume lifecycle event with the fixed text', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'running');
    await acts().recordAutoResume(await ctxFor(runId), { event: 'resume', try: 1, max: 5, end, at: atPlus(7) });
    const { events } = await load(runId);
    const evs = events.filter((e) => e.type === 'lifecycle');
    expect(evs).toHaveLength(1);
    expect(evs[0]?.payload).toEqual({
      kind: 'auto_resume',
      try: 1,
      max: 5,
      text: 'The last session was killed (OOMKilled, exit 137, limit 2Gi). Resuming automatically, try 1 of 5.',
    });
    expect(evs[0]?.ts.toISOString()).toBe(atPlus(7));
  });

  it('appends one auto_resume_gave_up lifecycle event', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'running');
    await acts().recordAutoResume(await ctxFor(runId), { event: 'gave_up', tries: 5, at: atPlus(8) });
    const { events } = await load(runId);
    const evs = events.filter((e) => e.type === 'lifecycle');
    expect(evs).toHaveLength(1);
    expect(evs[0]?.payload).toEqual({
      kind: 'auto_resume_gave_up',
      tries: 5,
      text: 'Gave up resuming automatically after 5 tries.',
    });
  });

  it.each([
    ['max above 10', { event: 'resume', try: 1, max: 11, end, at: AT }],
    ['try 0', { event: 'resume', try: 0, max: 5, end, at: AT }],
    ['try above max', { event: 'resume', try: 6, max: 5, end, at: AT }],
    ['tries 0', { event: 'gave_up', tries: 0, at: AT }],
    ['a bad timestamp', { event: 'gave_up', tries: 1, at: 'nope' }],
  ] as const)('rejects %s without appending', async (_name, input) => {
    const p = await seedProject();
    const runId = await seedRun(p, 'running');
    const err = await acts()
      .recordAutoResume(await ctxFor(runId), input)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ nonRetryable: true });
    expect((await load(runId)).events).toEqual([]);
  });

  it('rejects a missing run and another org context with run not found', async () => {
    const p = await seedProject();
    const runId = await seedRun(p, 'running');
    const ctx = await ctxFor(runId);
    const input = { event: 'gave_up', tries: 1, at: AT } as const;
    const missing = await acts()
      .recordAutoResume({ ...ctx, runId: '99999999-9999-4999-8999-999999999999' }, input)
      .catch((e: unknown) => e);
    expect(missing).toMatchObject({ message: expect.stringContaining('run not found') });
    const other = await acts()
      .recordAutoResume({ ...ctx, orgId: '77777777-7777-4777-8777-777777777777' }, input)
      .catch((e: unknown) => e);
    expect(other).toMatchObject({ message: expect.stringContaining('run not found') });
    expect((await load(runId)).events).toEqual([]);
  });
});
