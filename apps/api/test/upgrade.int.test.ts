import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { runs, withOrg } from '@agentdesk/db';
import { startPgAt } from '@agentdesk/db/testing';
import { devPassword } from '../src/auth/auth';
import { createTestApp, validEnv, type TestApp } from './helpers/app';
import { grant, inviteAndLogin, loginAs, userIdOf } from './helpers/auth';
import { freshStateDir } from './helpers/fixtures';

/**
 * The upgrade proof (BR-32, BR-66): a database that holds the rows a pre-RBAC install had (migration 0021) is
 * migrated forward and driven through the real API. Nobody keeps access by default; once granted, the old data is
 * there unchanged.
 */

const ORIGIN = 'http://localhost:5173';
const ALICE_EXTERNAL_ID = '777';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let old: Awaited<ReturnType<typeof startPgAt>>;
let t: TestApp;
let stateDir: string;
let wsBase: string;
let orgId: string;
let projectId: string;
let linkedRunId: string;
let ownerlessRunId: string;
let alice: string;
let aliceId: string;
let before: Snapshot;

type Snapshot = Record<string, Record<string, unknown>[]>;

/** Every seeded row as JSON, read as the owner role, so the upgrade can be shown to keep each column. */
async function snapshot(): Promise<Snapshot> {
  const client = new pg.Client({ connectionString: old.ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
      (await client.query<{ j: Record<string, unknown> }>(sql)).rows.map((r) => r.j);
    const out: Snapshot = {
      projects: await rows('select to_jsonb(p) as j from projects p order by id'),
      connections: await rows('select to_jsonb(c) as j from connections c order by id'),
      runs: await rows('select to_jsonb(r) as j from runs r order by id'),
      member: await rows('select to_jsonb(m) as j from member m order by id'),
      account: await rows('select to_jsonb(a) as j from account a order by id'),
    };
    await client.query('commit');
    return out;
  } finally {
    await client.end();
  }
}

function closeCodeOf(runId: string, cookie: string): Promise<number> {
  const ws = new WebSocket(`${wsBase}/api/runs/${runId}/terminal`, { headers: { cookie, origin: ORIGIN } });
  ws.on('error', () => undefined);
  return new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
}

const get = (url: string, cookie: string) => t.app.inject({ method: 'GET', url, headers: { cookie } });
const cancel = (runId: string, cookie: string) =>
  t.app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel`, headers: { cookie } });

/** Seeds what a pre-RBAC install holds, as the owner role at schema 0021: alice, her personal org, a board, a project, two runs. */
async function seedOldInstall(): Promise<void> {
  orgId = randomUUID();
  const aliceUser = randomUUID();
  const email = 'alice@dev.local';
  const password = await hashPassword(devPassword(parseSecret(), email));
  const client = new pg.Client({ connectionString: old.ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into "user" (id, name, email, email_verified, handle) values ($1, 'alice', $2, true, 'alice')`,
      [aliceUser, email],
    );
    // The credential account dev-login signs in with, and the linked provider account the backfill matches.
    await client.query(
      `insert into account (id, account_id, provider_id, user_id, password, updated_at)
       values ($1, $2, 'credential', $2, $3, now())`,
      [randomUUID(), aliceUser, password],
    );
    await client.query(
      `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
      [randomUUID(), ALICE_EXTERNAL_ID, aliceUser],
    );
    await client.query(`insert into organization (id, name, slug, created_at) values ($1, 'alice', 'alice', now())`, [
      orgId,
    ]);
    await client.query(
      `insert into member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, 'owner', now())`,
      [randomUUID(), orgId, aliceUser],
    );
    await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const conn = await client.query<{ id: string }>(
      `insert into connections (org_id, provider, capabilities, external_id, account_name)
       values ($1, 'fake', '{"code":true,"board":true}', 'ext-alice', 'demo') returning id`,
      [orgId],
    );
    const proj = await client.query<{ id: string }>(
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
       values ($1, 'demo', 'dev/alice', $2, $2) returning id`,
      [orgId, conn.rows[0]?.id],
    );
    projectId = proj.rows[0]?.id ?? '';
    const insertRun = async (comment: string, status: string, external: string | null): Promise<string> => {
      const res = await client.query<{ id: string }>(
        `insert into runs (org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                           trigger_source, trigger_comment_id, command, triggered_by_external_id)
         values ($1, $2, 'fix', 'dev/alice#1', 'issue', 'main', $3, 'webhook', $4, '/fix', $5) returning id`,
        [orgId, projectId, status, comment, external],
      );
      return res.rows[0]?.id ?? '';
    };
    linkedRunId = await insertRun('linked', 'running', ALICE_EXTERNAL_ID);
    ownerlessRunId = await insertRun('ownerless', 'running', null);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

function parseSecret(): { BETTER_AUTH_SECRET: string } {
  return { BETTER_AUTH_SECRET: validEnv()['BETTER_AUTH_SECRET'] ?? '' };
}

beforeAll(async () => {
  old = await startPgAt('0021_agent_auto_resume_max');
  await seedOldInstall();
  before = await snapshot();
  await old.migrateRest();
  stateDir = freshStateDir();
  t = await createTestApp({ pg: old, env: { FAKE_STATE_DIR: stateDir } });
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  wsBase = `ws://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
  alice = await loginAs(t, 'alice');
  aliceId = await userIdOf(t, 'alice');
}, 180_000);

afterAll(async () => {
  await t?.close();
  await old?.stop();
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

describe('upgrade from 0021', () => {
  it('signs the existing user in, with the old org as the active one', async () => {
    expect(alice).not.toBe('');
    expect(aliceId).toMatch(UUID_RE);
    const [row] = (
      await t.db.pool.query<{ organization_id: string }>('select organization_id from member where user_id = $1', [
        aliceId,
      ])
    ).rows;
    expect(row?.organization_id).toBe(orgId);
  });

  it('BR-32: the project, run and rule reads and a run cancel answer 403 and the terminal closes 4403 until a grant exists', async () => {
    expect((await get('/api/projects', alice)).statusCode).toBe(403);
    expect((await get(`/api/projects/${projectId}/runs`, alice)).statusCode).toBe(403);
    expect((await get(`/api/projects/${projectId}/rules`, alice)).statusCode).toBe(403);
    expect((await cancel(linkedRunId, alice)).statusCode).toBe(403);
    expect(await closeCodeOf(ownerlessRunId, alice)).toBe(4403);
    const assignments = await t.db.pool.query<{ n: string }>('select count(*) as n from role_assignments');
    expect(Number(assignments.rows[0]?.n)).toBe(0);
  });

  it('BR-32: after a grant the old project and both runs read back unchanged, and the matched run is alice own', async () => {
    await grant(t, orgId, aliceId, 'member', { type: 'project', projectId });

    const projects = await get('/api/projects', alice);
    expect(projects.statusCode).toBe(200);
    const listed = projects.json<{ items: { id: string; name: string; repoPath: string }[] }>().items;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: projectId, name: 'demo', repoPath: 'dev/alice' });
    const one = await get(`/api/projects/${projectId}`, alice);
    expect(one.statusCode).toBe(200);
    expect(one.json()).toMatchObject({ id: projectId, name: 'demo', repoPath: 'dev/alice' });

    const runsRes = await get(`/api/projects/${projectId}/runs`, alice);
    expect(runsRes.statusCode).toBe(200);
    const items = runsRes.json<{ items: { id: string; status: string }[] }>().items;
    expect(items.map((r) => [r.id, r.status]).sort()).toEqual(
      [
        [linkedRunId, 'running'],
        [ownerlessRunId, 'running'],
      ].sort(),
    );

    expect(await ownerOf(linkedRunId)).toBe(aliceId);
    expect(await ownerOf(ownerlessRunId)).toBeNull();
  });

  it('BR-32: every seeded row keeps all its old column values through the migrations', async () => {
    const after = await snapshot();
    expect(before['projects']).toHaveLength(1);
    expect(before['runs']).toHaveLength(2);
    expect(before['account']).toHaveLength(2);
    for (const table of Object.keys(before)) {
      // The migrations only add columns (owner_user_id, origin_run_id, ...): each old row is a subset of the new one.
      // Later tests add rows (bob), so each old row is found again by id.
      for (const old of before[table] ?? []) {
        const row = after[table]?.find((r) => r['id'] === old['id']);
        expect(row, `${table} ${String(old['id'])}`).toMatchObject(old);
      }
    }
    expect(after['member']?.find((m) => m['user_id'] === aliceId)).toMatchObject({ role: 'owner' });
  });

  it('BR-66: a member controls the run the backfill gave her, gets 403 on the ownerless run and 4403 on its terminal; an admin on the project cancels it', async () => {
    await grant(t, orgId, aliceId, 'member', { type: 'project', projectId });
    expect(await closeCodeOf(linkedRunId, alice)).not.toBe(4403);
    expect((await cancel(linkedRunId, alice)).statusCode).toBe(202);
    expect((await cancel(ownerlessRunId, alice)).statusCode).toBe(403);
    expect(await closeCodeOf(ownerlessRunId, alice)).toBe(4403);

    const bob = await inviteAndLogin(t, orgId, 'bob', 'admin', { type: 'project', projectIds: [projectId] });
    expect((await cancel(ownerlessRunId, bob)).statusCode).toBe(202);
  });
});

async function ownerOf(runId: string): Promise<string | null> {
  const [row] = await withOrg(t.db, orgId, (tx) =>
    tx.select({ ownerUserId: runs.ownerUserId }).from(runs).where(eq(runs.id, runId)),
  );
  return row?.ownerUserId ?? null;
}
