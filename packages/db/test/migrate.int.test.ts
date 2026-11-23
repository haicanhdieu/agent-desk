import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '../src/bootstrap';
import { runMigrations } from '../src/migrate';
import { startPg, startPgAt, TEST_PASSWORDS, type TestPg } from './helpers/pg';

const APP_TABLES = [
  'connections',
  'projects',
  'agents',
  'rules',
  'runs',
  'run_events',
  'run_transcript_entries',
  'inbound_events',
  'poll_cursors',
  'audit_log',
  'setup_script_versions',
  'setup_tests',
  'setup_test_events',
  'roles',
  'role_permissions',
  'role_assignments',
  'invitations',
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

  it('runs.owner_user_id and runs.origin_run_id are nullable, and their indexes exist', async () => {
    const cols = await query<{ column_name: string; is_nullable: string; data_type: string }>(
      env.ownerUrl,
      `select column_name, is_nullable, data_type from information_schema.columns
       where table_name = 'runs' and column_name in ('owner_user_id','origin_run_id') order by 1`,
    );
    expect(cols).toEqual([
      { column_name: 'origin_run_id', is_nullable: 'YES', data_type: 'uuid' },
      { column_name: 'owner_user_id', is_nullable: 'YES', data_type: 'text' },
    ]);
    const idx = await query<{ indexname: string }>(
      env.ownerUrl,
      "select indexname from pg_indexes where indexname in ('runs_origin_run_id_idx','runs_owner_user_idx') order by 1",
    );
    expect(idx.map((i) => i.indexname)).toEqual(['runs_origin_run_id_idx', 'runs_owner_user_idx']);
  });

  it('role_assignments.user_id has an index that leads with it (FK index rule)', async () => {
    const [idx] = await query<{ indexdef: string }>(
      env.ownerUrl,
      "select indexdef from pg_indexes where indexname = 'role_assignments_user_id_idx'",
    );
    expect(idx?.indexdef).toContain('(user_id)');
  });

  it('the RBAC indexes match their lookups and list orders', async () => {
    const rows = await query<{ indexname: string; indexdef: string }>(
      env.ownerUrl,
      `select indexname, indexdef from pg_indexes
       where indexname in ('account_provider_account_idx','runs_project_finished_idx','invitations_org_created_idx','role_assignments_org_granted_idx')
       order by 1`,
    );
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(defs.account_provider_account_idx).toContain('(provider_id, account_id)');
    expect(defs.runs_project_finished_idx).toContain('(project_id, finished_at)');
    expect(defs.invitations_org_created_idx).toContain('(org_id, created_at DESC, id DESC)');
    expect(defs.role_assignments_org_granted_idx).toContain('(org_id, granted_at DESC, id)');
    expect(rows).toHaveLength(4);
  });

  it('user has an expression index on lower(email) for platform-admin lookups', async () => {
    const [idx] = await query<{ indexdef: string }>(
      env.ownerUrl,
      "select indexdef from pg_indexes where indexname = 'user_email_lower_idx'",
    );
    expect(idx?.indexdef).toContain('lower(email)');
  });

  it('audit_log.project_ids is uuid[] not null with a GIN index, forced RLS and a containment query', async () => {
    const [col] = await query<{ data_type: string; udt_name: string; is_nullable: string; column_default: string }>(
      env.ownerUrl,
      "select data_type, udt_name, is_nullable, column_default from information_schema.columns where table_name = 'audit_log' and column_name = 'project_ids'",
    );
    expect(col).toMatchObject({ data_type: 'ARRAY', udt_name: '_uuid', is_nullable: 'NO' });
    expect(col?.column_default).toContain("'{}'");
    const [idx] = await query<{ amname: string }>(
      env.ownerUrl,
      "select am.amname from pg_class c join pg_am am on am.oid = c.relam where c.relname = 'audit_log_project_ids_idx'",
    );
    expect(idx?.amname).toBe('gin');
    const [rls] = await query<{ relforcerowsecurity: boolean }>(
      env.ownerUrl,
      "select relforcerowsecurity from pg_class where relname = 'audit_log'",
    );
    expect(rls?.relforcerowsecurity).toBe(true);
    const org = randomUUID();
    const p1 = randomUUID();
    const p2 = randomUUID();
    const client = new pg.Client({ connectionString: env.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [org]);
      await client.query(
        "insert into audit_log (org_id, action, project_ids) values ($1, 'tagged', array[$2]::uuid[]), ($1, 'other', array[$3]::uuid[]), ($1, 'untagged', default)",
        [org, p1, p2],
      );
      const hit = await client.query<{ action: string }>(
        'select action from audit_log where org_id = $1 and project_ids @> array[$2]::uuid[]',
        [org, p1],
      );
      await client.query('rollback');
      expect(hit.rows.map((r) => r.action)).toEqual(['tagged']);
    } finally {
      await client.end();
    }
  });

  it('inbound_events has a partial (project_id, ticket_ref) index for the ignored-event ref lookup', async () => {
    const [idx] = await query<{ indexdef: string }>(
      env.ownerUrl,
      "select indexdef from pg_indexes where indexname = 'inbound_events_project_ticket_ref_ignored_idx'",
    );
    expect(idx?.indexdef).toContain('(project_id, ticket_ref)');
    expect(idx?.indexdef).toContain("WHERE starts_with(outcome, 'ignored_'::text)");
  });

  it('the two runs foreign keys from the RBAC migration are added NOT VALID (validated in a later release)', async () => {
    const rows = await query<{ conname: string; convalidated: boolean }>(
      env.ownerUrl,
      "select conname, convalidated from pg_constraint where conname in ('runs_owner_user_id_user_id_fk','runs_origin_run_id_runs_id_fk') order by 1",
    );
    expect(rows).toEqual([
      { conname: 'runs_origin_run_id_runs_id_fk', convalidated: false },
      { conname: 'runs_owner_user_id_user_id_fk', convalidated: false },
    ]);
  });

  it('a run inserted without owner or origin reads back a null owner and origin', async () => {
    const orgId = randomUUID();
    const client = new pg.Client({ connectionString: env.appUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const conn = await client.query<{ id: string }>(
        `insert into connections (org_id, provider, capabilities, external_id, account_name)
         values ($1, 'fake', '{"code":true,"board":true}', 'acct-owner-null', 'demo') returning id`,
        [orgId],
      );
      const proj = await client.query<{ id: string }>(
        `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
         values ($1, 'demo', 'dev/owner-null', $2, $2) returning id`,
        [orgId, conn.rows[0]?.id],
      );
      await client.query(
        `insert into runs (org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                           trigger_source, trigger_comment_id, command)
         values ($1, $2, 'fix', 'dev/owner-null#1', 'issue', 'main', 'queued', 'webhook', 'c-null', '/fix')`,
        [orgId, proj.rows[0]?.id],
      );
      const rows = (
        await client.query<{ owner_user_id: string | null; origin_run_id: string | null }>(
          'select owner_user_id, origin_run_id from runs',
        )
      ).rows;
      expect(rows).toEqual([{ owner_user_id: null, origin_run_id: null }]);
    } finally {
      await client.query('rollback').catch(() => undefined);
      await client.end();
    }
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

  it('ignored-events partial index matches the list order (received_at desc, id) and its predicate', async () => {
    const rows = await query<{ indexdef: string }>(
      env.ownerUrl,
      "select indexdef from pg_indexes where tablename = 'inbound_events' and indexname = 'inbound_events_project_received_ignored_idx'",
    );
    expect(rows).toHaveLength(1);
    // Plain DESC (NULLS FIRST) is what `ORDER BY received_at DESC` needs; NULLS LAST would not serve it.
    expect(rows[0]?.indexdef).toContain('(project_id, received_at DESC, id)');
    expect(rows[0]?.indexdef).toContain("WHERE starts_with(outcome, 'ignored_'::text)");
  });

  it('linked issue refs have a partial GIN index over PR runs for the reverse lookup', async () => {
    const rows = await query<{ indexdef: string }>(
      env.ownerUrl,
      "select indexdef from pg_indexes where tablename = 'runs' and indexname = 'runs_linked_issue_refs_idx'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain('USING gin (linked_issue_refs)');
    expect(rows[0]?.indexdef).toContain("WHERE (ticket_kind = 'pr'::text)");
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

    it('the run pause reason check also accepts agent_crashed and still rejects others', async () => {
      for (const reason of ['agent_crashed', 'idle_timeout', 'pod_lost']) {
        await inOrg((c) =>
          c.query(`update runs set pause_reason = '${reason}' where trigger_comment_id = 'c-2'`).then(() => undefined),
        );
      }
      await expect(
        inOrg((c) =>
          c.query(`update runs set pause_reason = 'x' where trigger_comment_id = 'c-2'`).then(() => undefined),
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'runs_pause_reason_check' });
    });

    it('the agent_crashed migration only swaps the check: no row writes, no policy or grant changes', async () => {
      const sqlText = await readFile(
        new URL('../migrations/0014_run_pause_reason_agent_crashed.sql', import.meta.url),
        'utf8',
      );
      expect(sqlText).not.toMatch(/\b(update|delete|insert)\b/i);
      expect(sqlText).not.toMatch(/\b(create\s+policy|alter\s+policy|grant)\b/i);
    });

    it('agents.idle_end_seconds defaults to 30 minutes for new and existing agents and is limited to 5 minutes to 7 days', async () => {
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
      await expect(ins('idle_end_seconds=299')).rejects.toMatchObject({
        code: '23514',
        constraint: 'agents_idle_end_check',
      });
      await expect(ins('idle_end_seconds=604801')).rejects.toMatchObject({ code: '23514' });
      await ins('idle_end_seconds=300');
      await ins('idle_end_seconds=604800');
      await ins('');
      const rows = await query<{ idle_end_seconds: number; name: string }>(
        env.adminUrl.replace(/\/[^/]*$/, '/agentdesk'),
        'select idle_end_seconds, name from agents',
      );
      expect(rows.length).toBeGreaterThan(0);
      // Rows inserted without the column (and every agent that existed before it) get 30 minutes.
      expect(rows.some((r) => r.idle_end_seconds === 1800)).toBe(true);
      for (const r of rows) expect([300, 604800, 1800]).toContain(r.idle_end_seconds);
    });

    it('the idle end migration only adds a column and a check: no row writes, no policy or grant changes', async () => {
      const sqlText = await readFile(new URL('../migrations/0015_agent_idle_end.sql', import.meta.url), 'utf8');
      expect(sqlText).not.toMatch(/\b(update|delete|insert)\b/i);
      expect(sqlText).not.toMatch(/\b(create\s+policy|alter\s+policy|grant)\b/i);
    });

    it('agents.auto_resume_max defaults to 5 for new agents and is limited to 0 to 10', async () => {
      const ins = (name: string, extra: string) =>
        inOrg((c) =>
          c
            .query(
              `insert into agents (org_id, project_id, name, model${extra ? ', ' + extra.split('=')[0] : ''})
               values ($1, $2, $3, 'm'${extra ? ', ' + extra.split('=')[1] : ''})`,
              [orgId, projectId, name],
            )
            .then(() => undefined),
        );
      await expect(ins(`a-${randomUUID()}`, 'auto_resume_max=-1')).rejects.toMatchObject({
        code: '23514',
        constraint: 'agents_auto_resume_max_check',
      });
      await expect(ins(`a-${randomUUID()}`, 'auto_resume_max=11')).rejects.toMatchObject({
        code: '23514',
        constraint: 'agents_auto_resume_max_check',
      });
      const names = { zero: `a-${randomUUID()}`, ten: `a-${randomUUID()}`, none: `a-${randomUUID()}` };
      await ins(names.zero, 'auto_resume_max=0');
      await ins(names.ten, 'auto_resume_max=10');
      await ins(names.none, '');
      const rows = await query<{ name: string; auto_resume_max: number }>(
        env.adminUrl.replace(/\/[^/]*$/, '/agentdesk'),
        'select name, auto_resume_max from agents where name = any($1)',
        [Object.values(names)],
      );
      const byName = new Map(rows.map((r) => [r.name, r.auto_resume_max]));
      expect(byName.get(names.zero)).toBe(0);
      expect(byName.get(names.ten)).toBe(10);
      // The row inserted without the column gets 5.
      expect(byName.get(names.none)).toBe(5);
    });

    it('the auto resume migration only adds a column and a check', async () => {
      const sqlText = await readFile(new URL('../migrations/0021_agent_auto_resume_max.sql', import.meta.url), 'utf8');
      const statements = sqlText
        .split('--> statement-breakpoint')
        .map((x) => x.trim())
        .filter(Boolean);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toMatch(/^ALTER TABLE "agents" ADD COLUMN "auto_resume_max" integer DEFAULT 5 NOT NULL;$/);
      expect(statements[1]).toMatch(
        /^ALTER TABLE "agents" ADD CONSTRAINT "agents_auto_resume_max_check" CHECK \(.*between 0 and 10\);$/,
      );
    });

    it('the agent model routing migration only adds columns and checks: no row writes, no policy or grant changes', async () => {
      const sqlText = await readFile(new URL('../migrations/0017_agent_model_routing.sql', import.meta.url), 'utf8');
      expect(sqlText).not.toMatch(/\b(update|insert|delete)\b/i);
      expect(sqlText).not.toMatch(/\b(policy|grant)\b/i);

      const insAgent = (baseUrl: string) =>
        inOrg((c) =>
          c
            .query(
              `insert into agents (org_id, project_id, name, model, base_url)
               values ($1, $2, 'a-${randomUUID()}', 'm', ${baseUrl})`,
              [orgId, projectId],
            )
            .then(() => undefined),
        );
      await expect(insAgent("'http://x'")).rejects.toMatchObject({
        code: '23514',
        constraint: 'agents_base_url_check',
      });
      await expect(insAgent("'https://' || repeat('a', 2041)")).rejects.toMatchObject({
        code: '23514',
        constraint: 'agents_base_url_check',
      });
      await insAgent("'https://' || repeat('a', 2040)");
      await insAgent("'https://gw.example.com'");
      await insAgent('null');

      const agent = await query<{ id: string }>(
        env.adminUrl.replace(/\/[^/]*$/, '/agentdesk'),
        'select id from agents limit 1',
      );
      const agentId = agent[0]?.id ?? '';
      const insRule = (model: string) =>
        inOrg((c) =>
          c
            .query(
              `insert into rules (org_id, project_id, command, agent_id, skill_name, model)
               values ($1, $2, '/m-${randomUUID()}', $3, 'fix', ${model})`,
              [orgId, projectId, agentId],
            )
            .then(() => undefined),
        );
      await expect(insRule("repeat('a', 201)")).rejects.toMatchObject({
        code: '23514',
        constraint: 'rules_model_check',
      });
      await expect(insRule("''")).rejects.toMatchObject({ code: '23514', constraint: 'rules_model_check' });
      await insRule("repeat('a', 200)");
      await insRule('null');

      await inOrg((c) =>
        c.query(`update runs set model = null where trigger_comment_id = 'c-2'`).then(() => undefined),
      );
    });

    it('0018 adds stopped to the pause reason check and writes no rows', async () => {
      const sqlText = await readFile(
        new URL('../migrations/0018_run_pause_reason_stopped.sql', import.meta.url),
        'utf8',
      );
      expect(sqlText).not.toMatch(/\b(update|delete|insert)\b/i);
      await inOrg((c) =>
        c.query(`update runs set pause_reason = 'stopped' where trigger_comment_id = 'c-2'`).then(() => undefined),
      );
      await expect(
        inOrg((c) =>
          c.query(`update runs set pause_reason = 'nope' where trigger_comment_id = 'c-2'`).then(() => undefined),
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'runs_pause_reason_check' });
    });

    it('0019 creates run_transcript_entries with forced RLS and the run_events grants', async () => {
      const force = await query<{ relforcerowsecurity: boolean }>(
        env.ownerUrl,
        `select relforcerowsecurity from pg_class where relname = 'run_transcript_entries'`,
      );
      expect(force).toEqual([{ relforcerowsecurity: true }]);
      const grants = await query<{ privilege_type: string }>(
        env.ownerUrl,
        `select privilege_type from information_schema.role_table_grants
         where table_name = 'run_transcript_entries' and grantee = 'agentdesk_app' order by 1`,
      );
      expect(grants.map((g) => g.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);

      const entry = (c: pg.Client, runId: string, seq: number, sourceId: string, kind: string) =>
        c
          .query(
            `insert into run_transcript_entries (org_id, run_id, seq, source_id, at, kind, text)
             values ($1, $2, $3, $4, now(), $5, 'hello')`,
            [orgId, runId, seq, sourceId, kind],
          )
          .then(() => undefined);
      const runIdOf = async (c: pg.Client, comment: string): Promise<string> => {
        const r = await c.query<{ id: string }>('select id from runs where trigger_comment_id = $1', [comment]);
        return r.rows[0]?.id ?? '';
      };
      await inOrg(async (c) => entry(c, await runIdOf(c, 'c-2'), 1, 'src-1', 'agent'));
      await expect(inOrg(async (c) => entry(c, await runIdOf(c, 'c-2'), 2, 'src-1', 'agent'))).rejects.toMatchObject({
        code: '23505',
        constraint: 'run_transcript_entries_source_key',
      });
      await expect(inOrg(async (c) => entry(c, await runIdOf(c, 'c-2'), 3, 'src-3', 'thinking'))).rejects.toMatchObject(
        { code: '23514', constraint: 'run_transcript_entries_kind_check' },
      );
      await inOrg(async (c) => {
        await c.query(`delete from runs where trigger_comment_id = 'c-2'`);
        const left = await c.query('select 1 from run_transcript_entries');
        expect(left.rowCount).toBe(0);
      });
    });

    it("runs.linked_issue_refs is text[] not null default '{}', existing rows read '{}', and the app role writes it", async () => {
      const cols = await query<{ data_type: string; udt_name: string; is_nullable: string; column_default: string }>(
        env.ownerUrl,
        `select data_type, udt_name, is_nullable, column_default from information_schema.columns
         where table_name = 'runs' and column_name = 'linked_issue_refs'`,
      );
      expect(cols).toHaveLength(1);
      expect(cols[0]).toMatchObject({ data_type: 'ARRAY', udt_name: '_text', is_nullable: 'NO' });
      expect(cols[0]?.column_default).toContain("'{}'");

      await inOrg((c) => insertRun(c, 'c-linked'));
      await inOrg(async (c) => {
        const r = await c.query<{ linked_issue_refs: string[] }>(
          "select linked_issue_refs from runs where trigger_comment_id = 'c-linked'",
        );
        expect(r.rows[0]?.linked_issue_refs).toEqual([]);
        await c.query("update runs set linked_issue_refs = '{142}' where trigger_comment_id = 'c-linked'");
        const w = await c.query<{ linked_issue_refs: string[] }>(
          "select linked_issue_refs from runs where trigger_comment_id = 'c-linked'",
        );
        expect(w.rows[0]?.linked_issue_refs).toEqual(['142']);
        await c.query(
          `insert into runs (org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                             trigger_source, trigger_comment_id, command, linked_issue_refs)
           values ($1, $2, 'fix', 'dev/demo#2', 'pr', 'main', 'queued', 'webhook', 'c-linked-2', '/fix', '{142}')`,
          [orgId, projectId],
        );
      });
      await inOrg(async (c) => {
        await c.query("delete from runs where trigger_comment_id in ('c-linked','c-linked-2')");
      });

      const sqlText = await readFile(
        new URL('../migrations/0022_runs_add_linked_issue_refs.sql', import.meta.url),
        'utf8',
      );
      expect(sqlText).not.toMatch(/\b(update|delete|insert)\s+(from\s+|into\s+)?"?runs"?/i);
      expect(sqlText.replace(/-->.*\n?/g, '').trim()).toBe(
        'ALTER TABLE "runs" ADD COLUMN "linked_issue_refs" text[] DEFAULT \'{}\'::text[] NOT NULL;',
      );
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

describe('role templates and run owner backfill on an upgraded database', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = `user-a-${randomUUID()}`;
  const userB = `user-b-${randomUUID()}`;
  // Replayed in order: 0032 removes the Desk reads that 0026 seeds, so it must follow 0026.
  const FILES = [
    '0026_seed_role_templates.sql',
    '0027_backfill_run_owner.sql',
    '0032_revoke_desk_reads_member_viewer.sql',
    '0035_seed_audit_read.sql',
  ];
  const BULK_RUNS = 1001;
  let old: Awaited<ReturnType<typeof startPgAt>>;
  let adminDbUrl: string;
  let before: Record<'member' | 'projects' | 'connections', unknown[]>;

  async function snapshot(): Promise<Record<'member' | 'projects' | 'connections', unknown[]>> {
    return {
      member: await query(adminDbUrl, 'select * from member order by id'),
      projects: await query(adminDbUrl, 'select * from projects order by id'),
      connections: await query(adminDbUrl, 'select * from connections order by id'),
    };
  }

  async function counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of ['role_templates', 'role_template_permissions', 'roles', 'role_permissions', 'role_assignments']) {
      const [row] = await query<{ n: string }>(adminDbUrl, `select count(*)::text as n from ${t}`);
      out[t] = Number(row?.n);
    }
    return out;
  }

  async function owners(): Promise<Record<string, string | null>> {
    const rows = await query<{ trigger_comment_id: string; owner_user_id: string | null }>(
      adminDbUrl,
      "select trigger_comment_id, owner_user_id from runs where trigger_comment_id not like 'b-bulk-%' and trigger_comment_id not like 'b-skip-%'",
    );
    return Object.fromEntries(rows.map((r) => [r.trigger_comment_id, r.owner_user_id]));
  }

  async function seedOldOrg(orgId: string, userId: string, externalAccount: string, slug: string): Promise<void> {
    await query(old.ownerUrl, `insert into "user" (id, name, email, handle) values ($1, $1, $2, $1)`, [
      userId,
      `${userId}@example.test`,
    ]);
    await query(
      old.ownerUrl,
      `insert into account (id, account_id, provider_id, user_id, updated_at) values ($1, $2, 'fake', $3, now())`,
      [`acc-${userId}`, externalAccount, userId],
    );
    await query(old.ownerUrl, `insert into organization (id, name, slug, created_at) values ($1, $2, $2, now())`, [
      orgId,
      slug,
    ]);
    await query(
      old.ownerUrl,
      `insert into member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, 'owner', now())`,
      [`mem-${userId}`, orgId, userId],
    );
    const client = new pg.Client({ connectionString: old.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const conn = await client.query<{ id: string }>(
        `insert into connections (org_id, provider, capabilities, external_id, account_name)
         values ($1, 'fake', '{"code":true,"board":true}', $2, 'demo') returning id`,
        [orgId, `ext-${slug}`],
      );
      const proj = await client.query<{ id: string }>(
        `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
         values ($1, 'demo', $2, $3, $3) returning id`,
        [orgId, `dev/${slug}`, conn.rows[0]?.id],
      );
      const runs: [string, string | null][] =
        slug === 'org-a'
          ? [
              ['a-linked', externalAccount],
              ['a-unlinked', 'nobody-linked'],
              ['a-other-provider', 'ext-other-provider'],
              ['a-ambiguous', 'ext-shared'],
            ]
          : [
              ['b-linked', externalAccount],
              ['b-no-external-id', null],
            ];
      for (const [comment, external] of runs) {
        await client.query(
          `insert into runs (org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                             trigger_source, trigger_comment_id, command, triggered_by_external_id)
           values ($1, $2, 'fix', $3, 'issue', 'main', 'queued', 'webhook', $4, '/fix', $5)`,
          [orgId, proj.rows[0]?.id, `dev/${slug}#1`, comment, external],
        );
      }
      await client.query(`insert into audit_log (org_id, action) values ($1, 'old.entry')`, [orgId]);
      if (slug === 'org-b') {
        // More matching runs than one backfill batch (1000), so the loop must go round again.
        await client.query(
          `insert into runs (org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                             trigger_source, trigger_comment_id, command, triggered_by_external_id)
           select $1, $2, 'fix', $3, 'issue', 'main', 'queued', 'webhook', 'b-bulk-' || n, '/fix', $4
           from generate_series(1, ${BULK_RUNS}) as n`,
          [orgId, proj.rows[0]?.id, `dev/${slug}#1`, externalAccount],
        );
        // Owner-less runs with no linked account, as many as one batch, mixed by random id with the matching ones.
        // They never enter the backfill's candidates, so they must stay owner-less. The keyset itself only avoids
        // re-reading rows and cannot be told apart from the old loop by a result check; the bulk test below is what
        // fails if `last_id` skips a matching run or the loop stops early.
        await client.query(
          `insert into runs (org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                             trigger_source, trigger_comment_id, command, triggered_by_external_id)
           select $1, $2, 'fix', $3, 'issue', 'main', 'queued', 'webhook', 'b-skip-' || n, '/fix', 'nobody-linked'
           from generate_series(1, ${BULK_RUNS}) as n`,
          [orgId, proj.rows[0]?.id, `dev/${slug}#1`],
        );
      }
      await client.query('commit');
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    old = await startPgAt('0021_agent_auto_resume_max');
    const u = new URL(old.adminUrl);
    u.pathname = '/agentdesk';
    adminDbUrl = u.toString();
    await seedOldOrg(orgA, userA, 'ext-user-a', 'org-a');
    await seedOldOrg(orgB, userB, 'ext-user-b', 'org-b');
    // A linked account of another provider must not own a run whose board is a different provider.
    await query(
      old.ownerUrl,
      `insert into account (id, account_id, provider_id, user_id, updated_at)
       values ('acc-other', 'ext-other-provider', 'other', $1, now())`,
      [userA],
    );
    // One external commenter linked to two users is ambiguous: nobody owns that run.
    for (const userId of [userA, userB]) {
      await query(
        old.ownerUrl,
        `insert into account (id, account_id, provider_id, user_id, updated_at)
         values ($1, 'ext-shared', 'fake', $2, now())`,
        [`acc-shared-${userId}`, userId],
      );
    }
    before = await snapshot();
    await old.migrateRest();
  }, 180_000);

  afterAll(async () => {
    await old?.stop();
  });

  it('startPgAt stops before the new migrations until migrateRest runs', async () => {
    const stopped = await startPgAt('0021_agent_auto_resume_max');
    try {
      const rows = await query<{ n: string }>(
        stopped.ownerUrl,
        "select count(*)::text as n from information_schema.tables where table_name in ('roles','role_templates')",
      );
      expect(rows).toEqual([{ n: '0' }]);
      await stopped.migrateRest();
      const after = await query<{ n: string }>(stopped.ownerUrl, 'select count(*)::text as n from role_templates');
      expect(after).toEqual([{ n: '4' }]);
    } finally {
      await stopped.stop();
    }
  }, 180_000);

  it('existing audit rows of every org read project_ids as an empty array after the column migration', async () => {
    const rows = await query<{ org_id: string; project_ids: string[] }>(
      adminDbUrl,
      "select org_id, project_ids from audit_log where action = 'old.entry' order by org_id",
    );
    expect(rows.map((r) => r.org_id).sort()).toEqual([orgA, orgB].sort());
    expect(rows.every((r) => r.project_ids.length === 0)).toBe(true);
  });

  it('every existing org gets exactly the four built-in roles once, copied from the templates', async () => {
    for (const orgId of [orgA, orgB]) {
      const rows = await query<{ key: string; built_in: boolean; has_template: boolean; n: string }>(
        adminDbUrl,
        `select r.key, r.built_in, r.template_id is not null as has_template,
                (select count(*) from role_permissions rp where rp.role_id = r.id)::text as n
         from roles r where r.org_id = $1 order by r.key`,
        [orgId],
      );
      expect(rows).toEqual([
        { key: 'admin', built_in: true, has_template: true, n: '34' },
        { key: 'member', built_in: true, has_template: true, n: '6' },
        { key: 'owner', built_in: true, has_template: true, n: '35' },
        { key: 'viewer', built_in: true, has_template: true, n: '2' },
      ]);
    }
    const [total] = await query<{ n: string }>(adminDbUrl, 'select count(*)::text as n from roles');
    expect(total).toEqual({ n: '8' });
  });

  it('copied roles keep the template scopes and permission conditions', async () => {
    const rows = await query<{ key: string; assignable_scopes: string[]; own: string[] }>(
      adminDbUrl,
      `select r.key, r.assignable_scopes,
              coalesce(array_agg(rp.permission order by rp.permission) filter (where rp.condition = 'own'), '{}') as own
       from roles r left join role_permissions rp on rp.role_id = r.id
       where r.org_id = $1 group by r.id order by r.key`,
      [orgA],
    );
    expect(rows).toEqual([
      { key: 'admin', assignable_scopes: ['org', 'project'], own: [] },
      { key: 'member', assignable_scopes: ['org', 'project'], own: ['run:cancel', 'run:update', 'terminal:attach'] },
      { key: 'owner', assignable_scopes: ['org'], own: [] },
      { key: 'viewer', assignable_scopes: ['org', 'project'], own: [] },
    ]);
  });

  it('no assignment is created and member, projects and connections rows are unchanged', async () => {
    expect((await counts()).role_assignments).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('the backfill sets owner_user_id only where a linked account of the board provider matches', async () => {
    expect(await owners()).toEqual({
      'a-linked': userA,
      'a-unlinked': null,
      'a-other-provider': null,
      'a-ambiguous': null,
      'b-linked': userB,
      'b-no-external-id': null,
    });
  });

  it('the backfill keeps going past the first batch of 1000 runs', async () => {
    const rows = await query<{ owned: string; total: string }>(
      adminDbUrl,
      `select count(*) filter (where owner_user_id = $1)::text as owned, count(*)::text as total
       from runs where trigger_comment_id like 'b-bulk-%'`,
      [userB],
    );
    expect(rows).toEqual([{ owned: String(BULK_RUNS), total: String(BULK_RUNS) }]);
  });

  it('the backfill leaves runs with no linked account owner-less', async () => {
    const rows = await query<{ owned: string; total: string }>(
      adminDbUrl,
      `select count(owner_user_id)::text as owned, count(*)::text as total
       from runs where trigger_comment_id like 'b-skip-%'`,
    );
    expect(rows).toEqual([{ owned: '0', total: String(BULK_RUNS) }]);
  });

  it('running both data migrations again changes nothing', async () => {
    const countsBefore = await counts();
    const ownersBefore = await owners();
    for (const file of FILES) {
      const text = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
      const client = new pg.Client({ connectionString: old.ownerUrl });
      await client.connect();
      try {
        await client.query('begin');
        for (const statement of text.split('--> statement-breakpoint')) await client.query(statement);
        await client.query('commit');
      } finally {
        await client.end();
      }
    }
    expect(await counts()).toEqual(countsBefore);
    expect(await owners()).toEqual(ownersBefore);
  });

  it('no tenant role or template line holds a platform permission', async () => {
    for (const t of ['role_permissions', 'role_template_permissions']) {
      const [row] = await query<{ n: string }>(
        adminDbUrl,
        `select count(*)::text as n from ${t} where permission like 'platform-%'`,
      );
      expect(row, t).toEqual({ n: '0' });
    }
  });
});

describe('declined invitations migration is additive (N-7)', () => {
  const orgId = randomUUID();
  let old: Awaited<ReturnType<typeof startPgAt>>;
  let roleId: string;
  let before: unknown[];

  async function ownerTx<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const client = new pg.Client({ connectionString: old.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const r = await client.query<T>(sql, params);
      await client.query('commit');
      return r.rows;
    } finally {
      await client.end();
    }
  }

  const readAll = () => ownerTx('select * from invitations order by email');

  beforeAll(async () => {
    old = await startPgAt('0027_backfill_run_owner');
    const [role] = await ownerTx<{ id: string }>(
      `insert into roles (org_id, key, name, assignable_scopes) values ($1, 'member', 'Member', '{org}') returning id`,
      [orgId],
    );
    roleId = role?.id ?? '';
    const rows: [string, string, string][] = [
      ['pending-7d@x.io', 'pending', "now() + interval '7 days'"],
      ['pending-1d@x.io', 'pending', "now() + interval '1 day'"],
      ['accepted@x.io', 'accepted', "now() + interval '7 days'"],
      ['revoked@x.io', 'revoked', "now() + interval '7 days'"],
      ['expired@x.io', 'expired', "now() - interval '1 day'"],
    ];
    for (const [email, status, expires] of rows) {
      await ownerTx(
        `insert into invitations (org_id, email, role_id, scope_type, status, expires_at, invited_by)
         values ($1, $2, $3, 'org', $4, ${expires}, 'u1')`,
        [orgId, email, roleId, status],
      );
    }
    before = await readAll();
    await old.migrateRest();
  }, 180_000);

  afterAll(async () => {
    await old?.stop();
  });

  it('leaves every existing row and its expires_at unchanged', async () => {
    expect(before).toHaveLength(5);
    expect(await readAll()).toEqual(before);
  });

  it('accepts a declined row and still rejects an unknown status', async () => {
    await ownerTx(
      `insert into invitations (org_id, email, role_id, scope_type, status, expires_at, invited_by)
       values ($1, 'declined@x.io', $2, 'org', 'declined', now() + interval '2 days', 'u1')`,
      [orgId, roleId],
    );
    await expect(
      ownerTx(
        `insert into invitations (org_id, email, role_id, scope_type, status, expires_at, invited_by)
         values ($1, 'bogus@x.io', $2, 'org', 'bogus', now() + interval '2 days', 'u1')`,
        [orgId, roleId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('migration 0033: platform_admins and platform_audit_log (N-2)', () => {
  let old: Awaited<ReturnType<typeof startPgAt>>;

  const owner = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> =>
    query<T>(old.ownerUrl, sql, params);
  const priv = async (table: string, p: string): Promise<boolean> =>
    (await owner<{ ok: boolean }>("select has_table_privilege('agentdesk_app', $1, $2) as ok", [table, p]))[0]?.ok ===
    true;
  const insertAdmin = (email: string) => owner('insert into platform_admins (email) values ($1)', [email]);

  beforeAll(async () => {
    old = await startPgAt('0032_revoke_desk_reads_member_viewer');
    await owner(
      `insert into "user" (id, name, email, email_verified, handle) values ('u-pre', 'Pre', 'pre@x.io', true, 'pre')`,
    );
    await old.migrateRest();
  }, 180_000);

  afterAll(async () => {
    await old?.stop();
  });

  it('applies on top of 0032 with an existing user and creates both tables empty', async () => {
    expect(await owner('select * from platform_admins')).toEqual([]);
    expect(await owner('select * from platform_audit_log')).toEqual([]);
    expect(await owner('select id from "user"')).toEqual([{ id: 'u-pre' }]);
  });

  it('rejects a second entry for the same email with a unique violation', async () => {
    await insertAdmin('dup@x.io');
    await expect(insertAdmin('dup@x.io')).rejects.toMatchObject({ code: '23505' });
  });

  it.each(['Ops@x.io', '', ' ops@x.io'])('rejects the email %j with a check violation', async (email) => {
    await expect(insertAdmin(email)).rejects.toMatchObject({ code: '23514' });
  });

  it('gives the app role SELECT, INSERT and DELETE on platform_admins, and no UPDATE', async () => {
    expect(await priv('platform_admins', 'SELECT')).toBe(true);
    expect(await priv('platform_admins', 'INSERT')).toBe(true);
    expect(await priv('platform_admins', 'DELETE')).toBe(true);
    expect(await priv('platform_admins', 'UPDATE')).toBe(false);
  });

  it('gives the app role only SELECT and INSERT on platform_audit_log', async () => {
    expect(await priv('platform_audit_log', 'SELECT')).toBe(true);
    expect(await priv('platform_audit_log', 'INSERT')).toBe(true);
    expect(await priv('platform_audit_log', 'UPDATE')).toBe(false);
    expect(await priv('platform_audit_log', 'DELETE')).toBe(false);
  });

  it('indexes platform_audit_log by (created_at, id)', async () => {
    const rows = await owner<{ col: string }>(
      `select a.attname as col from pg_index i
       join pg_class c on c.oid = i.indexrelid
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where c.relname = 'platform_audit_log_created_at_idx'
       order by array_position(i.indkey::int2[], a.attnum)`,
    );
    expect(rows.map((r) => r.col)).toEqual(['created_at', 'id']);
  });

  it('has no org_id column and no RLS on either table', async () => {
    const cols = await owner(
      `select table_name from information_schema.columns
       where table_name in ('platform_admins','platform_audit_log') and column_name = 'org_id'`,
    );
    expect(cols).toEqual([]);
    const rls = await owner<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname in ('platform_admins','platform_audit_log')`,
    );
    expect(rls.every((r) => !r.relrowsecurity)).toBe(true);
  });
});

describe('audit:read seed migration (0035) on an upgraded database (NO-4)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const MIGRATION = new URL('../migrations/0035_seed_audit_read.sql', import.meta.url);
  let old: Awaited<ReturnType<typeof startPgAt>>;

  async function owner<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], orgId?: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: old.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      if (orgId) await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const r = await client.query<T>(sql, params);
      await client.query('commit');
      return r.rows;
    } finally {
      await client.end();
    }
  }

  /** The way 0026 copied the templates into an org: roles, then role_permissions, in the org's own scope. */
  async function copyTemplates(orgId: string): Promise<void> {
    await owner(`insert into organization (id, name, slug, created_at) values ($1, $1, $1, now())`, [orgId]);
    await owner(
      `insert into roles (org_id, key, name, built_in, template_id, assignable_scopes)
       select $1::uuid, t.key, t.name, true, t.id, t.assignable_scopes from role_templates t`,
      [orgId],
      orgId,
    );
    await owner(
      `insert into role_permissions (org_id, role_id, permission, condition)
       select $1::uuid, r.id, tp.permission, tp.condition
       from roles r join role_template_permissions tp on tp.template_id = r.template_id where r.org_id = $1::uuid`,
      [orgId],
      orgId,
    );
  }

  /** `audit:read` lines per built-in role key of one org. */
  async function auditLines(orgId: string): Promise<Record<string, string[]>> {
    const rows = await owner<{ key: string; line: string }>(
      `select r.key, p.permission || '=' || p.condition as line from roles r
       join role_permissions p on p.role_id = r.id
       where r.org_id = $1 and p.permission = 'audit:read' order by 1, 2`,
      [orgId],
      orgId,
    );
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.key] ??= []).push(r.line);
    return out;
  }

  const templateAudit = async (): Promise<{ key: string; condition: string }[]> =>
    owner(
      `select t.key, p.condition from role_templates t
       join role_template_permissions p on p.template_id = t.id where p.permission = 'audit:read' order by 1`,
    );

  /** Template rows, plus role_permissions per org (forced RLS: a count only sees rows in the org's own scope). */
  const rowCounts = async (): Promise<string[]> => {
    const [templates] = await owner<{ n: string }>(`select count(*)::text as n from role_template_permissions`);
    const out = [`templates=${templates?.n}`];
    for (const orgId of [orgA, orgB]) {
      const [perOrg] = await owner<{ n: string }>(`select count(*)::text as n from role_permissions`, [], orgId);
      out.push(`${orgId}=${perOrg?.n}`);
    }
    return out;
  };

  beforeAll(async () => {
    old = await startPgAt('0032_revoke_desk_reads_member_viewer');
    await copyTemplates(orgA);
    await copyTemplates(orgB);
  }, 180_000);

  afterAll(async () => {
    await old?.stop();
  });

  it('starts with no audit:read anywhere', async () => {
    expect(await templateAudit()).toEqual([]);
    expect(await auditLines(orgA)).toEqual({});
  });

  it('adds one audit:read line to the owner and admin templates and each org copy, none to member or viewer', async () => {
    await old.migrateRest();
    expect(await templateAudit()).toEqual([
      { key: 'admin', condition: 'any' },
      { key: 'owner', condition: 'any' },
    ]);
    for (const orgId of [orgA, orgB]) {
      expect(await auditLines(orgId), orgId).toEqual({ admin: ['audit:read=any'], owner: ['audit:read=any'] });
    }
  });

  it('is idempotent: applying its SQL again changes no row count', async () => {
    const before = await rowCounts();
    for (const line of before.slice(1)) expect(line.split('=')[1], line).not.toBe('0');
    const sql = await readFile(MIGRATION, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) await owner(statement);
    expect(await rowCounts()).toEqual(before);
    expect(await auditLines(orgA)).toEqual({ admin: ['audit:read=any'], owner: ['audit:read=any'] });
  });
});

describe('project-audit:read seed migration (0036) on an upgraded database (N-PERM)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const orgC = randomUUID();
  const MIGRATION = new URL('../migrations/0036_seed_project_audit_read.sql', import.meta.url);
  const PERM = 'project-audit:read';
  let old: Awaited<ReturnType<typeof startPgAt>>;

  async function owner<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], orgId?: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: old.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      if (orgId) await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const r = await client.query<T>(sql, params);
      await client.query('commit');
      return r.rows;
    } finally {
      await client.end();
    }
  }

  /** The way 0026 copied the templates into an org: roles, then role_permissions, in the org's own scope. */
  async function copyTemplates(orgId: string): Promise<void> {
    await owner(`insert into organization (id, name, slug, created_at) values ($1, $1, $1, now())`, [orgId]);
    await owner(
      `insert into roles (org_id, key, name, built_in, template_id, assignable_scopes)
       select $1::uuid, t.key, t.name, true, t.id, t.assignable_scopes from role_templates t`,
      [orgId],
      orgId,
    );
    await owner(
      `insert into role_permissions (org_id, role_id, permission, condition)
       select $1::uuid, r.id, tp.permission, tp.condition
       from roles r join role_template_permissions tp on tp.template_id = r.template_id where r.org_id = $1::uuid`,
      [orgId],
      orgId,
    );
  }

  /** `project-audit:read` lines per built-in role key of one org. */
  async function lines(orgId: string): Promise<Record<string, string[]>> {
    const rows = await owner<{ key: string; line: string }>(
      `select r.key, p.permission || '=' || p.condition as line from roles r
       join role_permissions p on p.role_id = r.id
       where r.org_id = $1 and p.permission = $2 order by 1, 2`,
      [orgId, PERM],
      orgId,
    );
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.key] ??= []).push(r.line);
    return out;
  }

  const rowCounts = async (): Promise<string[]> => {
    const [templates] = await owner<{ n: string }>(`select count(*)::text as n from role_template_permissions`);
    const out = [`templates=${templates?.n}`];
    for (const orgId of [orgA, orgB]) {
      const [perOrg] = await owner<{ n: string }>(`select count(*)::text as n from role_permissions`, [], orgId);
      out.push(`${orgId}=${perOrg?.n}`);
    }
    return out;
  };

  const HELD = { admin: [`${PERM}=any`], owner: [`${PERM}=any`] };

  beforeAll(async () => {
    old = await startPgAt('0035_seed_audit_read');
    await copyTemplates(orgA);
    await copyTemplates(orgB);
  }, 180_000);

  afterAll(async () => {
    await old?.stop();
  });

  it('starts with no project-audit:read anywhere', async () => {
    expect(await lines(orgA)).toEqual({});
  });

  it('gives owner and admin exactly one line in each org, none to member or viewer', async () => {
    await old.migrateRest();
    for (const orgId of [orgA, orgB]) expect(await lines(orgId), orgId).toEqual(HELD);
  });

  it('is idempotent: applying its SQL again changes no row count', async () => {
    const before = await rowCounts();
    const sql = await readFile(MIGRATION, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) await owner(statement);
    expect(await rowCounts()).toEqual(before);
    expect(await lines(orgA)).toEqual(HELD);
  });

  it('an org created afterwards copies it from the templates', async () => {
    await copyTemplates(orgC);
    expect(await lines(orgC)).toEqual(HELD);
  });
});

describe('audit project backfill migration (0039) on an upgraded database (N-BACKFILL)', () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const MIGRATION = new URL('../migrations/0039_backfill_audit_project_ids.sql', import.meta.url);
  const ids = {
    p1: randomUUID(),
    p2: randomUUID(),
    pb: randomUUID(),
    run1: randomUUID(),
    deletedRun: randomUUID(),
    rule2: randomUUID(),
    agent1: randomUUID(),
    setup2: randomUUID(),
    inv: randomUUID(),
    invOrg: randomUUID(),
    runB: randomUUID(),
  };
  let old: Awaited<ReturnType<typeof startPgAt>>;

  async function owner<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], orgId?: string): Promise<T[]> {
    const client = new pg.Client({ connectionString: old.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      if (orgId) await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const r = await client.query<T>(sql, params);
      await client.query('commit');
      return r.rows;
    } finally {
      await client.end();
    }
  }

  /** One org with two projects (or one), their run, rule, agent, setup test, and a role to invite with. */
  async function seedOrg(orgId: string, projectIds: string[]): Promise<string> {
    await owner(`insert into organization (id, name, slug, created_at) values ($1, $1, $1, now())`, [orgId]);
    await owner(
      `insert into roles (org_id, key, name, built_in, template_id, assignable_scopes)
       select $1::uuid, t.key, t.name, true, t.id, t.assignable_scopes from role_templates t`,
      [orgId],
      orgId,
    );
    const [conn] = await owner<{ id: string }>(
      `insert into connections (org_id, provider, capabilities, external_id, account_name)
       values ($1, 'fake', '{"code":true,"board":true}', $2, 'demo') returning id`,
      [orgId, `acct-${orgId}`],
      orgId,
    );
    for (const [i, id] of projectIds.entries()) {
      await owner(
        `insert into projects (id, org_id, name, repo_path, code_connection_id, board_connection_id)
         values ($1, $2, $3, $4, $5, $5)`,
        [id, orgId, `p${i}`, `dev/${id}`, conn?.id],
        orgId,
      );
    }
    const [role] = await owner<{ id: string }>(
      `select id from roles where org_id = $1 and key = 'viewer'`,
      [orgId],
      orgId,
    );
    return role?.id ?? '';
  }

  async function addRun(orgId: string, projectId: string, id: string): Promise<void> {
    await owner(
      `insert into runs (id, org_id, project_id, skill_name, ticket_ref, ticket_kind, checkout_ref, status,
                         trigger_source, trigger_comment_id, command)
       values ($1::uuid, $2, $3, 'fix', $4, 'issue', 'main', 'queued', 'webhook', $1::text, '/fix')`,
      [id, orgId, projectId, `dev/x#${id}`],
      orgId,
    );
  }

  async function audit(
    orgId: string,
    key: string,
    action: string,
    targetType: string | null,
    targetId: string | null,
    payload: Record<string, unknown> = {},
    projectIds: string[] = [],
  ): Promise<void> {
    await owner(
      `insert into audit_log (org_id, action, target_type, target_id, payload, project_ids)
       values ($1, $2, $3, $4, $5::jsonb, $6::uuid[])`,
      [orgId, action, targetType, targetId, JSON.stringify({ ...payload, key }), projectIds],
      orgId,
    );
  }

  async function tags(orgId: string): Promise<Record<string, string[]>> {
    const rows = await owner<{ key: string; project_ids: string[] }>(
      `select payload->>'key' as key, project_ids from audit_log where org_id = $1`,
      [orgId],
      orgId,
    );
    return Object.fromEntries(rows.map((r) => [r.key, [...r.project_ids].sort()]));
  }

  beforeAll(async () => {
    old = await startPgAt('0038_audit_log_project_ids_idx');
    const roleA = await seedOrg(orgA, [ids.p1, ids.p2]);
    await seedOrg(orgB, [ids.pb]);
    await addRun(orgA, ids.p1, ids.run1);
    await addRun(orgB, ids.pb, ids.runB);
    await owner(
      `insert into agents (id, org_id, project_id, name, model) values ($1, $2, $3, 'a1', 'm')`,
      [ids.agent1, orgA, ids.p1],
      orgA,
    );
    await owner(
      `insert into rules (id, org_id, project_id, command, agent_id, skill_name) values ($1, $2, $3, '/r', $4, 'fix')`,
      [ids.rule2, orgA, ids.p2, ids.agent1],
      orgA,
    );
    await owner(
      `insert into setup_tests (id, org_id, project_id, status, script_sha256, started_by)
       values ($1, $2, $3, 'passed', 'sha', 'u1')`,
      [ids.setup2, orgA, ids.p2],
      orgA,
    );
    const inviteSql = `insert into invitations (id, org_id, email, role_id, scope_type, project_ids, status, expires_at, invited_by)
       values ($1, $2, $3, $4, $5, $6::uuid[], 'pending', now() + interval '7 days', 'u1')`;
    await owner(inviteSql, [ids.inv, orgA, 'a@example.com', roleA, 'project', [ids.p1, ids.p2]], orgA);
    await owner(inviteSql, [ids.invOrg, orgA, 'b@example.com', roleA, 'org', []], orgA);

    await audit(orgA, 'project', 'projects.update', 'projects', ids.p1);
    await audit(orgA, 'project-bad-id', 'projects.update', 'projects', 'not-a-uuid');
    await audit(orgA, 'run', 'runs.cancel', 'runs', ids.run1);
    await audit(orgA, 'run-deleted', 'runs.cancel', 'runs', ids.deletedRun);
    await audit(orgA, 'rule', 'rules.update', 'rules', ids.rule2);
    await audit(orgA, 'agent', 'agents.update', 'agents', ids.agent1);
    await audit(orgA, 'setup', 'setup-tests.create', 'setup-tests', ids.setup2);
    await audit(orgA, 'grant-project', 'assignment.granted', 'user', 'u2', {
      to: { roleKey: 'viewer', scope: { type: 'project', projectId: ids.p1 } },
    });
    await audit(orgA, 'revoke-project', 'assignment.revoked', 'user', 'u2', {
      from: { roleKey: 'viewer', scope: { type: 'project', projectId: ids.p2 } },
    });
    await audit(orgA, 'grant-org', 'assignment.granted', 'user', 'u2', {
      to: { roleKey: 'viewer', scope: { type: 'org' } },
    });
    for (const verb of ['created', 'resent', 'revoked', 'accepted', 'declined', 'expired']) {
      await audit(orgA, `inv-${verb}`, `invitation.${verb}`, 'invitation', ids.inv);
    }
    await audit(orgA, 'inv-org', 'invitation.created', 'invitation', ids.invOrg);
    await audit(orgA, 'org-route', 'PATCH members.update', 'members', 'u2');
    await audit(orgA, 'already-tagged', 'projects.update', 'projects', ids.p1, {}, [ids.p2]);
    await audit(orgB, 'b-project', 'projects.update', 'projects', ids.pb);
    await audit(orgB, 'b-run', 'runs.cancel', 'runs', ids.runB);
    await audit(orgB, 'b-foreign-run', 'runs.cancel', 'runs', ids.run1);
  }, 180_000);

  afterAll(async () => {
    await old?.stop();
  });

  const count = async (orgId: string): Promise<number> =>
    Number((await owner<{ n: string }>(`select count(*)::text as n from audit_log`, [], orgId))[0]?.n);

  it('starts with every row untagged except the pre-tagged one', async () => {
    const t = await tags(orgA);
    expect(t['project']).toEqual([]);
    expect(t['already-tagged']).toEqual([ids.p2]);
  });

  it('tags each row from its target and leaves untied rows org-only', async () => {
    const before = [await count(orgA), await count(orgB)];
    await old.migrateRest();
    const a = await tags(orgA);
    const both = [ids.p1, ids.p2].sort();
    expect(a).toMatchObject({
      project: [ids.p1],
      run: [ids.p1],
      rule: [ids.p2],
      agent: [ids.p1],
      setup: [ids.p2],
      'grant-project': [ids.p1],
      'revoke-project': [ids.p2],
      'inv-created': both,
      'inv-resent': both,
      'inv-revoked': both,
      'inv-accepted': both,
      'inv-declined': both,
      'inv-expired': both,
      'project-bad-id': [],
      'run-deleted': [],
      'grant-org': [],
      'inv-org': [],
      'org-route': [],
      'already-tagged': [ids.p2],
    });
    const b = await tags(orgB);
    expect(b).toEqual({ 'b-project': [ids.pb], 'b-run': [ids.pb], 'b-foreign-run': [] });
    expect([await count(orgA), await count(orgB)]).toEqual(before);
  });

  it('is idempotent: applying its SQL again changes no tag', async () => {
    const before = [await tags(orgA), await tags(orgB)];
    const sql = await readFile(MIGRATION, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) await owner(statement);
    expect([await tags(orgA), await tags(orgB)]).toEqual(before);
  });
});
