import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  'setup_tests',
  'setup_test_events',
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

  it('agents.timeout_seconds allows 60 s to 7 days and defaults to 24 h (ADR 0021)', async () => {
    const [check] = await query<{ def: string }>(
      env.ownerUrl,
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'agents_timeout_check'",
    );
    expect(check?.def).toContain('604800');
    expect(check?.def).not.toContain('3300');
    const [col] = await query<{ column_default: string }>(
      env.ownerUrl,
      "select column_default from information_schema.columns where table_name = 'agents' and column_name = 'timeout_seconds'",
    );
    expect(col?.column_default).toBe('86400');
  });

  it('the run time limit migration changes no rows, so existing agents keep their saved value', async () => {
    const sqlText = await readFile(new URL('../migrations/0010_agent_timeout_7_days.sql', import.meta.url), 'utf8');
    expect(sqlText).not.toMatch(/\b(update|delete|insert)\b/i);
  });

  it('the pause and resume migration changes no runs rows', async () => {
    const sqlText = await readFile(new URL('../migrations/0011_run_pause_resume.sql', import.meta.url), 'utf8');
    expect(sqlText).not.toMatch(/\b(update|delete|insert)\s+(from\s+|into\s+)?"?runs"?/i);
  });

  it('agents keep settings default to 7 days paused and 24 h done, with range checks', async () => {
    const cols = await query<{ column_name: string; column_default: string; is_nullable: string }>(
      env.ownerUrl,
      `select column_name, column_default, is_nullable from information_schema.columns
       where table_name = 'agents' and column_name in ('paused_keep_seconds','done_keep_seconds') order by 1`,
    );
    expect(cols).toEqual([
      { column_name: 'done_keep_seconds', column_default: '86400', is_nullable: 'NO' },
      { column_name: 'paused_keep_seconds', column_default: '604800', is_nullable: 'NO' },
    ]);
    const checks = await query<{ conname: string; def: string }>(
      env.ownerUrl,
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
       where conname in ('agents_paused_keep_check','agents_done_keep_check') order by 1`,
    );
    expect(checks.map((c) => c.conname)).toEqual(['agents_done_keep_check', 'agents_paused_keep_check']);
    expect(checks[0]?.def).toMatch(/>= 0\).*<= 604800/);
    expect(checks[1]?.def).toMatch(/>= 3600\).*<= 2592000/);
  });

  it('runs have nullable paused_at and session_expires_at, and the session index exists', async () => {
    const cols = await query<{ column_name: string; is_nullable: string; data_type: string }>(
      env.ownerUrl,
      `select column_name, is_nullable, data_type from information_schema.columns
       where table_name = 'runs' and column_name in ('paused_at','session_expires_at') order by 1`,
    );
    expect(cols).toEqual([
      { column_name: 'paused_at', is_nullable: 'YES', data_type: 'timestamp with time zone' },
      { column_name: 'session_expires_at', is_nullable: 'YES', data_type: 'timestamp with time zone' },
    ]);
    const [idx] = await query<{ indexdef: string }>(
      env.ownerUrl,
      "select indexdef from pg_indexes where indexname = 'runs_project_session_idx'",
    );
    expect(idx?.indexdef).toContain('(project_id, session_expires_at)');
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

  it('setup test FK and list indexes exist', async () => {
    const rows = await query<{ indexname: string; indexdef: string }>(
      env.ownerUrl,
      `select indexname, indexdef from pg_indexes
       where indexname in ('setup_tests_project_created_idx','setup_tests_org_idx','setup_test_events_org_idx') order by 1`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      'setup_test_events_org_idx',
      'setup_tests_org_idx',
      'setup_tests_project_created_idx',
    ]);
    expect(rows[2]?.indexdef).toMatch(/\(project_id, created_at DESC/);
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

    it('runs have nullable setup_script_version and failure_stage; the app role updates them; the check rejects others', async () => {
      await inOrg((c) =>
        c
          .query(`update runs set setup_script_version = 3, failure_stage = 'setup' where trigger_comment_id = 'c-2'`)
          .then(() => undefined),
      );
      const rows = await query<{ setup_script_version: number | null; failure_stage: string | null }>(
        env.ownerUrl.replace(/\/[^/]*$/, '/agentdesk'),
        `select setup_script_version, failure_stage from runs order by number`,
      );
      expect(rows).toEqual([
        { setup_script_version: null, failure_stage: null },
        { setup_script_version: 3, failure_stage: 'setup' },
      ]);
      await expect(
        inOrg((c) =>
          c.query(`update runs set failure_stage = 'bogus' where trigger_comment_id = 'c-2'`).then(() => undefined),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('runs accept paused and expired, still reject unknown statuses', async () => {
      for (const status of ['paused', 'expired']) {
        await inOrg((c) =>
          c.query(`update runs set status = '${status}' where trigger_comment_id = 'c-2'`).then(() => undefined),
        );
      }
      await expect(
        inOrg((c) =>
          c.query(`update runs set status = 'bogus' where trigger_comment_id = 'c-2'`).then(() => undefined),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('agents reject paused_keep_seconds 3599 and done_keep_seconds out of range; existing rows get defaults', async () => {
      const ins = (extra: string) =>
        inOrg((c) =>
          c
            .query(
              `insert into agents (org_id, project_id, name, model${extra ? ', ' + extra.split('=')[0] : ''})
               values ($1, $2, 'a-${randomUUID()}', 'm'${extra ? ', ' + extra.split('=')[1] : ''})`,
              [orgId, projectId],
            )
            .then(() => undefined),
        );
      await expect(ins('paused_keep_seconds=3599')).rejects.toMatchObject({ code: '23514' });
      await expect(ins('done_keep_seconds=604801')).rejects.toMatchObject({ code: '23514' });
      await ins('');
      const rows = await query<{ paused_keep_seconds: number; done_keep_seconds: number }>(
        env.adminUrl.replace(/\/[^/]*$/, '/agentdesk'),
        'select paused_keep_seconds, done_keep_seconds from agents',
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r).toEqual({ paused_keep_seconds: 604800, done_keep_seconds: 86400 });
    });

    it('projects accept the setup onboarding step, keep existing steps valid and reject unknown ones', async () => {
      await inOrg((c) => c.query(`update projects set setup_step = 'setup'`).then(() => undefined));
      for (const step of ['agent', 'skills', 'rules', 'ready']) {
        await inOrg((c) => c.query(`update projects set setup_step = '${step}'`).then(() => undefined));
      }
      await expect(
        inOrg((c) => c.query(`update projects set setup_step = 'bogus'`).then(() => undefined)),
      ).rejects.toMatchObject({ code: '23514' });
    });

    describe('rule custom prompt', () => {
      let agentId = '';

      beforeAll(async () => {
        await inOrg(async (c) => {
          const a = await c.query<{ id: string }>(
            `insert into agents (org_id, project_id, name, model) values ($1, $2, 'a1', 'm') returning id`,
            [orgId, projectId],
          );
          agentId = a.rows[0]?.id ?? '';
        });
      });

      async function insertRule(command: string, skillName: string | null, prompt: string | null): Promise<void> {
        await inOrg(async (c) => {
          await c.query(
            `insert into rules (org_id, project_id, command, agent_id, skill_name, prompt)
             values ($1, $2, $3, $4, $5, $6)`,
            [orgId, projectId, command, agentId, skillName, prompt],
          );
        });
      }

      it('a rule needs exactly one of skill_name and prompt', async () => {
        await expect(insertRule('/both', 'fix', 'p')).rejects.toMatchObject({
          code: '23514',
          constraint: 'rules_skill_or_prompt_check',
        });
        await expect(insertRule('/none', null, null)).rejects.toMatchObject({
          code: '23514',
          constraint: 'rules_skill_or_prompt_check',
        });
        await expect(insertRule('/prompt-only', null, 'p')).resolves.toBeUndefined();
        await expect(insertRule('/skill-only', 'fix', null)).resolves.toBeUndefined();
      });

      it('a rule prompt is at most 4000 characters', async () => {
        await expect(insertRule('/len-ok', null, 'x'.repeat(4000))).resolves.toBeUndefined();
        await expect(insertRule('/len-bad', null, 'x'.repeat(4001))).rejects.toMatchObject({
          code: '23514',
          constraint: 'rules_prompt_length_check',
        });
      });

      it('runs keep prompt and final_prompt and allow a null skill_name', async () => {
        await inOrg((c) =>
          c
            .query(
              `insert into runs (org_id, project_id, skill_name, prompt, ticket_ref, ticket_kind, checkout_ref, status,
                                 trigger_source, trigger_comment_id, command)
               values ($1, $2, null, 'p', 'dev/demo#2', 'issue', 'main', 'queued', 'webhook', 'c-prompt', '/p')`,
              [orgId, projectId],
            )
            .then(() => undefined),
        );
        const cols = await query<{ column_name: string; is_nullable: string }>(
          env.ownerUrl,
          `select column_name, is_nullable from information_schema.columns
           where table_name = 'runs' and column_name in ('skill_name','prompt','final_prompt') order by 1`,
        );
        expect(cols).toEqual([
          { column_name: 'final_prompt', is_nullable: 'YES' },
          { column_name: 'prompt', is_nullable: 'YES' },
          { column_name: 'skill_name', is_nullable: 'YES' },
        ]);
      });

      it('the custom prompt migration changes no rows', async () => {
        const sqlText = await readFile(new URL('../migrations/0012_rule_custom_prompt.sql', import.meta.url), 'utf8');
        expect(sqlText).not.toMatch(/\b(update|delete|insert)\b/i);
      });
    });

    it('runs have nullable session_ending_at and pause_reason; existing rows read back null; the check rejects others', async () => {
      const cols = await query<{ column_name: string; is_nullable: string; data_type: string }>(
        env.ownerUrl,
        `select column_name, is_nullable, data_type from information_schema.columns
         where table_name = 'runs' and column_name in ('session_ending_at','pause_reason') order by 1`,
      );
      expect(cols).toEqual([
        { column_name: 'pause_reason', is_nullable: 'YES', data_type: 'text' },
        { column_name: 'session_ending_at', is_nullable: 'YES', data_type: 'timestamp with time zone' },
      ]);
      const rows = await query<{ session_ending_at: Date | null; pause_reason: string | null }>(
        env.ownerUrl.replace(/\/[^/]*$/, '/agentdesk'),
        `select session_ending_at, pause_reason from runs where trigger_comment_id in ('c-1', 'c-2') order by number`,
      );
      expect(rows).toEqual([
        { session_ending_at: null, pause_reason: null },
        { session_ending_at: null, pause_reason: null },
      ]);
      for (const reason of ['idle_timeout', 'pod_lost']) {
        await inOrg((c) =>
          c.query(`update runs set pause_reason = '${reason}' where trigger_comment_id = 'c-2'`).then(() => undefined),
        );
      }
      await expect(
        inOrg((c) =>
          c.query(`update runs set pause_reason = 'x' where trigger_comment_id = 'c-2'`).then(() => undefined),
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('the session ending migration changes no runs rows', async () => {
      const sqlText = await readFile(new URL('../migrations/0013_run_session_ending.sql', import.meta.url), 'utf8');
      expect(sqlText).not.toMatch(/\b(update|delete|insert)\b/i);
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
