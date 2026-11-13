import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '../src/bootstrap';
import { runMigrations } from '../src/migrate';
import { startPg, TEST_PASSWORDS, type TestPg } from './helpers/pg';

const APP_TABLES = [
  'connections',
  'projects',
  'agents',
  'rules',
  'runs',
  'run_events',
  'inbound_events',
  'poll_cursors',
  'audit_log',
  'setup_script_versions',
];

let env: TestPg;

async function query<T extends pg.QueryResultRow>(url: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query<T>(sql, params)).rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  env = await startPg();
}, 180_000);

afterAll(async () => {
  await env?.stop();
});

describe('bootstrap and migrations', () => {
  it('bootstrap is idempotent', async () => {
    await bootstrapDatabase(env.adminUrl, TEST_PASSWORDS);
    await bootstrapDatabase(env.adminUrl, TEST_PASSWORDS);
    await runMigrations(env.ownerUrl);
    const rows = await query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      env.adminUrl,
      "select rolbypassrls, rolsuper from pg_roles where rolname = 'agentdesk_app'",
    );
    expect(rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);
    const dbs = await query<{ datname: string }>(
      env.adminUrl,
      "select datname from pg_database where datname in ('agentdesk','temporal','temporal_visibility') order by 1",
    );
    expect(dbs.map((d) => d.datname)).toEqual(['agentdesk', 'temporal', 'temporal_visibility']);
  });

  it('all app tables have org_id not null (except inbound_events)', async () => {
    const rows = await query<{ table_name: string; is_nullable: string; data_type: string }>(
      env.ownerUrl,
      "select table_name, is_nullable, data_type from information_schema.columns where table_schema = 'public' and column_name = 'org_id'",
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([...APP_TABLES].sort());
    for (const r of rows) {
      expect(r.data_type).toBe('uuid');
      expect(r.is_nullable, r.table_name).toBe(r.table_name === 'inbound_events' ? 'YES' : 'NO');
    }
  });

  it('rls is forced on every org table', async () => {
    const rows = await query<{ relname: string }>(
      env.ownerUrl,
      'select relname from pg_class where relrowsecurity and relforcerowsecurity',
    );
    expect(rows.map((r) => r.relname)).toEqual(expect.arrayContaining(APP_TABLES));
  });

  it('run list indexes exist (rule/queued_at and project/queued_at desc/id)', async () => {
    const rows = await query<{ indexname: string; indexdef: string }>(
      env.ownerUrl,
      "select indexname, indexdef from pg_indexes where tablename = 'runs' and indexname in ('runs_rule_queued_idx','runs_project_queued_idx') order by 1",
    );
    expect(rows.map((r) => r.indexname)).toEqual(['runs_project_queued_idx', 'runs_rule_queued_idx']);
    expect(rows[0]?.indexdef).toContain('(project_id, queued_at DESC, id)');
    expect(rows[1]?.indexdef).toContain('(rule_id, queued_at)');
  });

  it('foreign-key columns used by deletes and joins are indexed', async () => {
    const rows = await query<{ indexname: string; indexdef: string }>(
      env.ownerUrl,
      `select indexname, indexdef from pg_indexes
       where indexname in ('runs_agent_idx','runs_inbound_event_idx','projects_board_connection_idx','rules_agent_idx')
       order by 1`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      'projects_board_connection_idx',
      'rules_agent_idx',
      'runs_agent_idx',
      'runs_inbound_event_idx',
    ]);
    expect(rows[0]?.indexdef).toContain('(board_connection_id)');
    expect(rows[1]?.indexdef).toContain('(agent_id)');
    expect(rows[2]?.indexdef).toContain('(agent_id)');
    expect(rows[3]?.indexdef).toContain('(inbound_event_id)');
  });

  it('resolve_project stays security definer, pinned search_path, executable only by the app role', async () => {
    const fn = await query<{ prosecdef: boolean; proconfig: string[]; owner: string }>(
      env.ownerUrl,
      `select p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
       from pg_proc p where p.proname = 'resolve_project'`,
    );
    expect(fn).toEqual([{ prosecdef: true, proconfig: ['search_path=public, pg_temp'], owner: 'agentdesk_owner' }]);
    const grants = await query<{ grantee: string }>(
      env.ownerUrl,
      `select grantee from information_schema.routine_privileges
       where routine_name = 'resolve_project' and privilege_type = 'EXECUTE' order by 1`,
    );
    expect(grants.map((g) => g.grantee)).toEqual(['agentdesk_app', 'agentdesk_owner']);
  });

  it('app role cannot own or bypass; auth tables exist with user.handle', async () => {
    const cols = await query<{ column_name: string }>(
      env.ownerUrl,
      "select column_name from information_schema.columns where table_name = 'user' and column_name = 'handle'",
    );
    expect(cols).toHaveLength(1);
    const owners = await query<{ tableowner: string }>(
      env.ownerUrl,
      "select distinct tableowner from pg_tables where schemaname = 'public'",
    );
    expect(owners).toEqual([{ tableowner: 'agentdesk_owner' }]);
  });

  describe('runs constraints and numbering', () => {
    const orgId = randomUUID();
    let projectId: string;

    async function seed(): Promise<void> {
      const client = new pg.Client({ connectionString: env.appUrl });
      await client.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.org_id', $1, true)", [orgId]);
        const conn = await client.query<{ id: string }>(
          `insert into connections (org_id, provider, capabilities, external_id, account_name)
           values ($1, 'fake', '{"code":true,"board":true}', 'acct-1', 'demo') returning id`,
          [orgId],
        );
        const connId = conn.rows[0]?.id;
        const proj = await client.query<{ id: string }>(
          `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
           values ($1, 'demo', 'dev/demo', $2, $2) returning id`,
          [orgId, connId],
        );
        projectId = proj.rows[0]?.id ?? '';
        await client.query('commit');
      } finally {
        await client.end();
      }
    }

    async function insertRun(client: pg.Client, commentId: string): Promise<void> {
      await client.query(
        `insert into runs (org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                           trigger_source, trigger_comment_id, command)
         values ($1, $2, 'fix', 'dev/demo#1', 'issue', 'main', 'queued', 'webhook', $3, '/fix')`,
        [orgId, projectId, commentId],
      );
    }

    async function inOrg(fn: (c: pg.Client) => Promise<void>): Promise<void> {
      const client = new pg.Client({ connectionString: env.appUrl });
      await client.connect();
      try {
        await client.query('begin');
        await client.query("select set_config('app.org_id', $1, true)", [orgId]);
        await fn(client);
        await client.query('commit');
      } finally {
        await client.end();
      }
    }

    it('duplicate (project_id, trigger_comment_id) fails with 23505', async () => {
      await seed();
      await inOrg((c) => insertRun(c, 'c-1'));
      await expect(inOrg((c) => insertRun(c, 'c-1'))).rejects.toMatchObject({ code: '23505' });
    });

    it('duplicate (project_id, number) fails with 23505 and numbers auto-increment', async () => {
      await inOrg((c) => insertRun(c, 'c-2'));
      const rows = await query<{ number: number }>(
        env.adminUrl.replace(/\/[^/]*$/, '/agentdesk'),
        'select number from runs order by number',
      );
      expect(rows.map((r) => r.number)).toEqual([1, 2]);
      await expect(
        inOrg((c) => c.query(`update runs set number = 1 where trigger_comment_id = 'c-2'`).then(() => undefined)),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('resolve_project (security definer) finds the project across tenants as the app role', async () => {
      const rows = await query<{ org_id: string; project_id: string }>(
        env.appUrl,
        "select * from resolve_project('fake', 'acct-1', 'dev/demo')",
      );
      expect(rows).toEqual([{ org_id: orgId, project_id: projectId }]);
    });
  });
});
