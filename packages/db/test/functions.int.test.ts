import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createDb,
  invitationOrgForEmail,
  listenRunStatus,
  notifyRunStatus,
  pendingInvitationsForEmail,
  queuedRunsWithoutWorkflow,
  resolveProject,
  withOrg,
  type Db,
  type RunStatusMessage,
} from '../src';
import { startPg, type TestPg } from './helpers/pg';
import { ORG_A, ORG_B, seedOrg, seedRun, type SeededOrg } from './helpers/seed';

let pgx: TestPg;
let db: Db;
let a: SeededOrg;
let b: SeededOrg;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  a = await seedOrg(pgx.ownerUrl, ORG_A, {
    externalId: 'acct-1',
    repoPath: 'dev/demo',
  });
  b = await seedOrg(pgx.ownerUrl, ORG_B, {
    externalId: 'acct-2',
    repoPath: 'dev/other',
  });
});

afterAll(async () => {
  await db?.close();
  await pgx?.stop();
});

describe('resolveProject', () => {
  it('returns the org and project ids for a known repo', async () => {
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/demo')).toEqual({
      orgId: ORG_A,
      projectId: a.projectId,
    });
    expect(await resolveProject(db, 'fake', 'acct-2', 'dev/other')).toEqual({
      orgId: ORG_B,
      projectId: b.projectId,
    });
  });

  it('returns null for an unknown repo or a repo under another account', async () => {
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/nope')).toBeNull();
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/other')).toBeNull();
    expect(await resolveProject(db, 'other-provider', 'acct-1', 'dev/demo')).toBeNull();
  });

  it('does not resolve a project whose connection belongs to another org', async () => {
    // Connection in org B; a project in org A points at it (FK checks ignore RLS, so this can exist).
    const client = new pg.Client({ connectionString: pgx.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.org_id', $1, true)`, [ORG_B]);
      const conn = await client.query<{ id: string }>(
        `insert into connections (org_id, provider, capabilities, external_id, account_name)
         values ($1, 'fake', '{"code":true,"board":true}', 'acct-cross', 'acct') returning id`,
        [ORG_B],
      );
      await client.query(`select set_config('app.org_id', $1, true)`, [ORG_A]);
      await client.query(
        `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
         values ($1, 'cross', 'dev/cross', $2, $2)`,
        [ORG_A, conn.rows[0]?.id],
      );
      await client.query('commit');
    } finally {
      await client.end();
    }
    expect(await resolveProject(db, 'fake', 'acct-cross', 'dev/cross')).toBeNull();
    // A normal project still resolves.
    expect(await resolveProject(db, 'fake', 'acct-1', 'dev/demo')).toEqual({ orgId: ORG_A, projectId: a.projectId });
  });
});

describe('queuedRunsWithoutWorkflow', () => {
  it('returns only old queued runs without a workflow, from every org', async () => {
    const oldA = await seedRun(pgx.ownerUrl, a, {
      ageSeconds: 120,
      workflowId: null,
      ticketRef: '#10',
    });
    const oldB = await seedRun(pgx.ownerUrl, b, {
      ageSeconds: 120,
      workflowId: null,
      ticketRef: '#10',
    });
    await seedRun(pgx.ownerUrl, a, {
      ageSeconds: 120,
      workflowId: 'wf-1',
      ticketRef: '#11',
    });
    await seedRun(pgx.ownerUrl, b, {
      ageSeconds: 5,
      workflowId: null,
      ticketRef: '#11',
    });
    // The runs seeded by seedOrg are fresh (queued now), so they are excluded too.
    const got = await queuedRunsWithoutWorkflow(db, 30);
    expect(got).toHaveLength(2);
    expect(got).toEqual(
      expect.arrayContaining([
        { orgId: ORG_A, runId: oldA },
        { orgId: ORG_B, runId: oldB },
      ]),
    );
  });
});

describe('run_status notify', () => {
  it('is delivered to the listener only after the transaction commits', async () => {
    const got: RunStatusMessage[] = [];
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m));
    try {
      await withOrg(db, ORG_A, async (tx) => {
        await notifyRunStatus(tx, { orgId: ORG_A, runId: a.runId, seq: 7 });
        await sleep(400);
        expect(got).toEqual([]);
      });
      for (let i = 0; i < 50 && got.length === 0; i++) await sleep(100);
      expect(got).toEqual([{ orgId: ORG_A, runId: a.runId, seq: 7 }]);
    } finally {
      await stop();
    }
  });

  it('is not delivered when the transaction rolls back', async () => {
    const got: RunStatusMessage[] = [];
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m));
    try {
      await withOrg(db, ORG_A, async (tx) => {
        await notifyRunStatus(tx, { orgId: ORG_A, runId: a.runId, seq: 8 });
        throw new Error('boom');
      }).catch(() => undefined);
      await sleep(500);
      expect(got).toEqual([]);
    } finally {
      await stop();
    }
  });
});

describe('listenRunStatus lifecycle', () => {
  it('rejects on a bad url and leaves no retry loop', async () => {
    const spy = vi.spyOn(pg.Client.prototype, 'connect');
    try {
      await expect(
        listenRunStatus('postgres://nobody:x@127.0.0.1:1/none', () => undefined, { reconnectDelayMs: 20 }),
      ).rejects.toThrow();
      const calls = spy.mock.calls.length;
      await sleep(300);
      expect(spy.mock.calls.length).toBe(calls);
    } finally {
      spy.mockRestore();
    }
  });

  it('reconnects after its backend is terminated and keeps delivering', async () => {
    const got: RunStatusMessage[] = [];
    const stop = await listenRunStatus(pgx.appUrl, (m) => got.push(m), { reconnectDelayMs: 100 });
    const admin = new pg.Client({ connectionString: pgx.adminUrl });
    await admin.connect();
    try {
      await admin.query(
        `select pg_terminate_backend(pid) from pg_stat_activity where usename = 'agentdesk_app' and query ilike 'LISTEN%'`,
      );
      await sleep(600);
      await withOrg(db, ORG_A, (tx) => notifyRunStatus(tx, { orgId: ORG_A, runId: a.runId, seq: 9 }));
      for (let i = 0; i < 50 && got.length === 0; i++) await sleep(100);
      expect(got).toEqual([{ orgId: ORG_A, runId: a.runId, seq: 9 }]);
    } finally {
      await stop();
      await sleep(200);
      const r = await admin.query(
        `select 1 from pg_stat_activity where usename = 'agentdesk_app' and query ilike 'LISTEN%'`,
      );
      expect(r.rowCount).toBe(0);
      await admin.end();
    }
  });
});

describe('pendingInvitationsForEmail', () => {
  async function ownerQuery(stmt: string): Promise<pg.QueryResult> {
    const client = new pg.Client({ connectionString: pgx.ownerUrl });
    await client.connect();
    try {
      return await client.query(stmt);
    } finally {
      await client.end();
    }
  }

  /** Inserts an invitation as the owner (FORCE RLS: the org is set transaction-locally). `expires` is a SQL literal. */
  async function insertInvitation(o: SeededOrg, email: string, status: string, expires: string): Promise<void> {
    const client = new pg.Client({ connectionString: pgx.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.org_id', $1, true)`, [o.orgId]);
      await client.query(
        `insert into invitations (org_id, email, role_id, scope_type, status, expires_at, invited_by)
         values ($1, $2, $3, 'org', $4, ${expires}, $5)`,
        [o.orgId, email, o.memberRoleId, status, o.userId],
      );
      await client.query('commit');
    } finally {
      await client.end();
    }
  }

  it('returns id and org for pending unexpired rows of both orgs, case-insensitively', async () => {
    const got = await pendingInvitationsForEmail(db, 'Bob@X.io');
    expect(got).toHaveLength(2);
    expect(got).toEqual(
      expect.arrayContaining([
        { id: a.invitationId, orgId: ORG_A },
        { id: b.invitationId, orgId: ORG_B },
      ]),
    );
  });

  it('returns an empty list for an unknown email', async () => {
    expect(await pendingInvitationsForEmail(db, 'nobody@x.io')).toEqual([]);
  });

  it('exposes exactly the columns id and org_id', async () => {
    const r = await db.pool.query(`select * from pending_invitations_for_email('bob@x.io')`);
    expect(r.fields.map((f) => f.name)).toEqual(['id', 'org_id']);
  });

  it('omits expired, accepted and revoked rows', async () => {
    await insertInvitation(a, 'carol@x.io', 'pending', `now() - interval '1 second'`);
    await insertInvitation(a, 'carol@x.io', 'accepted', `now() + interval '7 days'`);
    await insertInvitation(b, 'carol@x.io', 'revoked', `now() + interval '7 days'`);
    expect(await pendingInvitationsForEmail(db, 'carol@x.io')).toEqual([]);
  });

  it('is security definer with a pinned search_path and executable only by the app role', async () => {
    const fn = await ownerQuery(
      `select prosecdef, proconfig, pg_get_userbyid(proowner) as owner from pg_proc where proname = 'pending_invitations_for_email'`,
    );
    expect(fn.rows).toEqual([
      { prosecdef: true, proconfig: ['search_path=public, pg_temp'], owner: 'agentdesk_owner' },
    ]);
    const grants = await ownerQuery(
      `select grantee from information_schema.routine_privileges
       where routine_name = 'pending_invitations_for_email' and privilege_type = 'EXECUTE' order by 1`,
    );
    expect(grants.rows.map((g: { grantee: string }) => g.grantee)).toEqual(['agentdesk_app', 'agentdesk_owner']);
  });

  it('has no PUBLIC execute and the definer policy only exposes pending, unexpired rows', async () => {
    const acl = await ownerQuery(
      `select has_function_privilege('public', 'pending_invitations_for_email(text)', 'EXECUTE') as public_exec,
              has_function_privilege('agentdesk_app', 'pending_invitations_for_email(text)', 'EXECUTE') as app_exec`,
    );
    expect(acl.rows).toEqual([{ public_exec: false, app_exec: true }]);
    // The owner has no app.org_id here, so only the definer_read policy applies: no expired, accepted or revoked rows.
    await insertInvitation(a, 'dave@x.io', 'pending', `now() - interval '1 second'`);
    await insertInvitation(a, 'dave@x.io', 'accepted', `now() + interval '7 days'`);
    const seen = await ownerQuery(
      `select count(*)::int as total,
              count(*) filter (where status <> 'pending' or expires_at <= now())::int as hidden
       from invitations`,
    );
    expect(seen.rows[0].total).toBeGreaterThan(0);
    expect(seen.rows[0].hidden).toBe(0);
  });
});

describe('invitationOrgForEmail', () => {
  const STATUSES = ['pending', 'accepted', 'declined', 'revoked', 'expired'] as const;
  const ids = new Map<string, string>();

  async function ownerQuery(stmt: string, params: unknown[] = [], org?: string): Promise<pg.QueryResult> {
    const client = new pg.Client({ connectionString: pgx.ownerUrl });
    await client.connect();
    try {
      await client.query('begin');
      if (org) await client.query(`select set_config('app.org_id', $1, true)`, [org]);
      const r = await client.query(stmt, params);
      await client.query('commit');
      return r;
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    for (const status of STATUSES) {
      // Each status has its own email so the one-pending-per-email key never collides.
      const r = await ownerQuery(
        `insert into invitations (org_id, email, role_id, scope_type, status, expires_at, invited_by)
         values ($1, $2, $3, 'org', $4, now() + interval '2 days', $5) returning id`,
        [a.orgId, `lookup-${status}@x.io`, a.memberRoleId, status, a.userId],
        a.orgId,
      );
      ids.set(status, (r.rows[0] as { id: string }).id);
    }
  });

  it.each(STATUSES)('returns the org id for the matching email on a %s invitation', async (status) => {
    expect(await invitationOrgForEmail(db, ids.get(status) ?? '', `lookup-${status}@x.io`)).toBe(ORG_A);
  });

  it('matches an upper-case email argument', async () => {
    expect(await invitationOrgForEmail(db, ids.get('pending') ?? '', 'Lookup-Pending@X.io')).toBe(ORG_A);
  });

  it("returns null for another email, a random uuid, and another org's invitation id with the wrong email", async () => {
    const pendingId = ids.get('pending') ?? '';
    expect(await invitationOrgForEmail(db, pendingId, 'someone-else@x.io')).toBeNull();
    expect(await invitationOrgForEmail(db, '8f1f2d54-0000-4000-8000-000000000000', 'lookup-pending@x.io')).toBeNull();
    expect(await invitationOrgForEmail(db, b.invitationId, 'lookup-pending@x.io')).toBeNull();
  });

  it('is security definer with a pinned search_path and executable only by the app role', async () => {
    const fn = await ownerQuery(
      `select prosecdef, proconfig, pg_get_userbyid(proowner) as owner from pg_proc where proname = 'invitation_org_for_email'`,
    );
    expect(fn.rows).toEqual([
      { prosecdef: true, proconfig: ['search_path=public, pg_temp'], owner: 'agentdesk_owner' },
    ]);
    const acl = await ownerQuery(
      `select has_function_privilege('public', 'invitation_org_for_email(uuid, text)', 'EXECUTE') as public_exec,
              has_function_privilege('agentdesk_app', 'invitation_org_for_email(uuid, text)', 'EXECUTE') as app_exec`,
    );
    expect(acl.rows).toEqual([{ public_exec: false, app_exec: true }]);
    const grants = await ownerQuery(
      `select grantee from information_schema.routine_privileges
       where routine_name = 'invitation_org_for_email' and privilege_type = 'EXECUTE' order by 1`,
    );
    expect(grants.rows.map((g: { grantee: string }) => g.grantee)).toEqual(['agentdesk_app', 'agentdesk_owner']);
  });

  it('clears the lookup setting after a call and a plain select still sees no invitation', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      await client.query('select invitation_org_for_email($1, $2)', [ids.get('declined'), 'lookup-declined@x.io']);
      const setting = await client.query(`select current_setting('agentdesk.invitation_lookup', true) as v`);
      expect(setting.rows[0].v ?? '').toBe('');
      const plain = await client.query('select 1 from invitations');
      expect(plain.rowCount).toBe(0);
      await client.query('commit');
    } finally {
      client.release();
    }
    // The owner without an org sees only what the definer policies allow: no declined, accepted or revoked row.
    const seen = await ownerQuery(
      `select count(*)::int as n from invitations where status in ('declined','revoked','accepted')`,
    );
    expect(seen.rows[0].n).toBe(0);
  });

  it('pendingInvitationsForEmail omits declined rows', async () => {
    expect(await pendingInvitationsForEmail(db, 'lookup-declined@x.io')).toEqual([]);
  });
});
