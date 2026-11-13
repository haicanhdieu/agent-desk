import pg from 'pg';

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';

export interface SeededOrg {
  orgId: string;
  connectionId: string;
  projectId: string;
  agentId: string;
  ruleId: string;
  runId: string;
}

/** Seeds one row in every app table for an org. Runs as the owner, which is bound by FORCE RLS, so the
 * org is set transaction-locally. */
export async function seedOrg(
  ownerUrl: string,
  orgId: string,
  o: { externalId: string; repoPath: string },
): Promise<SeededOrg> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.org_id', $1, true)`, [orgId]);
    const one = async (sql: string, params: unknown[]): Promise<string> => {
      const r = await client.query<{ id: string }>(sql, params);
      const row = r.rows[0];
      if (!row) throw new Error('seed insert returned no row');
      return row.id;
    };
    const connectionId = await one(
      `insert into connections (org_id, provider, capabilities, external_id, account_name)
       values ($1, 'fake', '{"code":true,"board":true}', $2, 'acct') returning id`,
      [orgId, o.externalId],
    );
    const projectId = await one(
      `insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
       values ($1, 'demo', $2, $3, $3) returning id`,
      [orgId, o.repoPath, connectionId],
    );
    const agentId = await one(
      `insert into agents (org_id, project_id, name, model) values ($1, $2, 'a1', 'm') returning id`,
      [orgId, projectId],
    );
    const ruleId = await one(
      `insert into rules (org_id, project_id, command, agent_id, skill_name)
       values ($1, $2, '/fix', $3, 'fix') returning id`,
      [orgId, projectId, agentId],
    );
    const runId = await one(
      `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source)
       values ($1, $2, '/fix', 'fix', '#1', 'issue', 'main', 'manual') returning id`,
      [orgId, projectId],
    );
    await client.query(`insert into run_events (org_id, run_id, seq, type) values ($1, $2, 1, 'status')`, [
      orgId,
      runId,
    ]);
    await client.query(
      `insert into inbound_events (org_id, project_id, provider, channel, delivery_id, outcome)
       values ($1, $2, 'fake', 'webhook', $3, 'accepted')`,
      [orgId, projectId, `d-${orgId}`],
    );
    await client.query(
      `insert into setup_script_versions (org_id, project_id, version, body, created_by) values ($1, $2, 1, 'echo hi', 'u1')`,
      [orgId, projectId],
    );
    await client.query(`insert into poll_cursors (org_id, project_id) values ($1, $2)`, [orgId, projectId]);
    await client.query(`insert into audit_log (org_id, action) values ($1, 'seed')`, [orgId]);
    await client.query('commit');
    return { orgId, connectionId, projectId, agentId, ruleId, runId };
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

/** Adds a run for an existing project, as the owner, with explicit age and workflow id. */
export async function seedRun(
  ownerUrl: string,
  s: SeededOrg,
  o: { ageSeconds: number; workflowId: string | null; ticketRef: string },
): Promise<string> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.org_id', $1, true)`, [s.orgId]);
    const r = await client.query<{ id: string }>(
      `insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source,
                         workflow_id, queued_at)
       values ($1, $2, '/fix', 'fix', $3, 'issue', 'main', 'manual', $4, now() - make_interval(secs => $5::int))
       returning id`,
      [s.orgId, s.projectId, o.ticketRef, o.workflowId, o.ageSeconds],
    );
    await client.query('commit');
    const row = r.rows[0];
    if (!row) throw new Error('seed run returned no row');
    return row.id;
  } finally {
    await client.end();
  }
}
