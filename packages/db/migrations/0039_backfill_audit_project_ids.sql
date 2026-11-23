-- Hand-written data migration (issue 191): tag existing audit_log rows with the projects they belong to.
-- Runs as agentdesk_owner. audit_log forces RLS, so app.org_id is set transaction-locally for each org.
-- Idempotent: every rule only touches rows whose project_ids is still '{}'. Rows that cannot be tied to a
-- project stay '{}'. No schema change. Uuid-shaped text is checked inside CASE before any ::uuid cast.
-- Batched per org and per rule (1000 rows, keyset on audit_log.id): a rule only selects rows it can tag, so rows
-- left untagged are never re-read. Each rule is a SELECT of (id, pids) over audit_log a with $1 = org id,
-- $2 = last id of the previous batch, $3 = the uuid pattern; the statements are fixed text, no row data is interpolated.
DO $$
DECLARE
  org record;
  rule_sql text;
  changed integer;
  last_id uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  rules constant text[] := ARRAY[
    -- 1. Project rows: the target is the project.
    $r$SELECT a.id, ARRAY[CASE WHEN a.target_id ~* $3 THEN a.target_id::uuid END] AS pids
       FROM audit_log a
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.target_type = 'projects' AND a.target_id ~* $3
         AND ($2 IS NULL OR a.id > $2)$r$,
    -- 2. Rows whose target belongs to one project: the joined row's project_id.
    $r$SELECT a.id, ARRAY[r.project_id] AS pids
       FROM audit_log a JOIN runs r ON r.id = CASE WHEN a.target_id ~* $3 THEN a.target_id::uuid END AND r.org_id = $1
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.target_type = 'runs'
         AND ($2 IS NULL OR a.id > $2)$r$,
    $r$SELECT a.id, ARRAY[r.project_id] AS pids
       FROM audit_log a JOIN rules r ON r.id = CASE WHEN a.target_id ~* $3 THEN a.target_id::uuid END AND r.org_id = $1
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.target_type = 'rules'
         AND ($2 IS NULL OR a.id > $2)$r$,
    $r$SELECT a.id, ARRAY[r.project_id] AS pids
       FROM audit_log a JOIN agents r ON r.id = CASE WHEN a.target_id ~* $3 THEN a.target_id::uuid END AND r.org_id = $1
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.target_type = 'agents'
         AND ($2 IS NULL OR a.id > $2)$r$,
    $r$SELECT a.id, ARRAY[r.project_id] AS pids
       FROM audit_log a JOIN setup_tests r ON r.id = CASE WHEN a.target_id ~* $3 THEN a.target_id::uuid END AND r.org_id = $1
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.target_type = 'setup-tests'
         AND ($2 IS NULL OR a.id > $2)$r$,
    -- 3. Project-scope grants and revokes: the project id in the payload.
    $r$SELECT a.id, ARRAY[CASE WHEN a.payload #>> '{to,scope,projectId}' ~* $3 THEN (a.payload #>> '{to,scope,projectId}')::uuid END] AS pids
       FROM audit_log a
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.action = 'assignment.granted'
         AND a.payload #>> '{to,scope,type}' = 'project' AND a.payload #>> '{to,scope,projectId}' ~* $3
         AND ($2 IS NULL OR a.id > $2)$r$,
    $r$SELECT a.id, ARRAY[CASE WHEN a.payload #>> '{from,scope,projectId}' ~* $3 THEN (a.payload #>> '{from,scope,projectId}')::uuid END] AS pids
       FROM audit_log a
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.action = 'assignment.revoked'
         AND a.payload #>> '{from,scope,type}' = 'project' AND a.payload #>> '{from,scope,projectId}' ~* $3
         AND ($2 IS NULL OR a.id > $2)$r$,
    -- 4. Invitation rows (expired included): the project-scope invitation's project ids.
    $r$SELECT a.id, i.project_ids AS pids
       FROM audit_log a
       JOIN invitations i ON i.id = CASE WHEN a.target_id ~* $3 THEN a.target_id::uuid END AND i.org_id = $1
         AND i.scope_type = 'project' AND cardinality(i.project_ids) >= 1
       WHERE a.org_id = $1 AND a.project_ids = '{}' AND a.action LIKE 'invitation.%' AND a.target_type = 'invitation'
         AND ($2 IS NULL OR a.id > $2)$r$
  ];
BEGIN
  FOR org IN
    SELECT id FROM organization WHERE id ~* uuid_re ORDER BY id
  LOOP
    PERFORM set_config('app.org_id', org.id, true);
    FOREACH rule_sql IN ARRAY rules
    LOOP
      last_id := NULL;
      LOOP
        EXECUTE 'WITH candidates AS (SELECT c.id, c.pids FROM (' || rule_sql || ') c ORDER BY c.id LIMIT 1000), '
          || 'updated AS (UPDATE audit_log u SET project_ids = candidates.pids FROM candidates '
          || 'WHERE u.id = candidates.id AND u.org_id = $1 AND u.project_ids = ''{}'' RETURNING u.id) '
          || 'SELECT count(*), (array_agg(id ORDER BY id DESC))[1] FROM updated'
          INTO changed, last_id
          USING org.id::uuid, last_id, uuid_re;
        EXIT WHEN changed = 0;
      END LOOP;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;
