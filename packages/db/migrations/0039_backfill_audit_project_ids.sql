-- Hand-written data migration (issue 191): tag existing audit_log rows with the projects they belong to.
-- Runs as agentdesk_owner. audit_log forces RLS, so app.org_id is set transaction-locally for each org.
-- Idempotent: every rule only touches rows whose project_ids is still '{}'. Rows that cannot be tied to a
-- project stay '{}'. No schema change. Uuid-shaped text is checked inside CASE before any ::uuid cast.
DO $$
DECLARE
  org record;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  FOR org IN
    SELECT id FROM organization WHERE id ~* uuid_re ORDER BY id
  LOOP
    PERFORM set_config('app.org_id', org.id, true);

    -- 1. Project rows: the target is the project.
    UPDATE audit_log a
    SET project_ids = ARRAY[a.target_id::uuid]
    WHERE a.org_id = org.id::uuid
      AND a.project_ids = '{}'
      AND a.target_type = 'projects'
      AND a.target_id ~* uuid_re;

    -- 2. Rows whose target belongs to one project: the joined row's project_id.
    UPDATE audit_log a
    SET project_ids = ARRAY[r.project_id]
    FROM runs r
    WHERE a.org_id = org.id::uuid AND a.project_ids = '{}' AND a.target_type = 'runs'
      AND r.org_id = org.id::uuid
      AND r.id = CASE WHEN a.target_id ~* uuid_re THEN a.target_id::uuid END;

    UPDATE audit_log a
    SET project_ids = ARRAY[r.project_id]
    FROM rules r
    WHERE a.org_id = org.id::uuid AND a.project_ids = '{}' AND a.target_type = 'rules'
      AND r.org_id = org.id::uuid
      AND r.id = CASE WHEN a.target_id ~* uuid_re THEN a.target_id::uuid END;

    UPDATE audit_log a
    SET project_ids = ARRAY[r.project_id]
    FROM agents r
    WHERE a.org_id = org.id::uuid AND a.project_ids = '{}' AND a.target_type = 'agents'
      AND r.org_id = org.id::uuid
      AND r.id = CASE WHEN a.target_id ~* uuid_re THEN a.target_id::uuid END;

    UPDATE audit_log a
    SET project_ids = ARRAY[r.project_id]
    FROM setup_tests r
    WHERE a.org_id = org.id::uuid AND a.project_ids = '{}' AND a.target_type = 'setup-tests'
      AND r.org_id = org.id::uuid
      AND r.id = CASE WHEN a.target_id ~* uuid_re THEN a.target_id::uuid END;

    -- 3. Project-scope grants and revokes: the project id in the payload.
    UPDATE audit_log a
    SET project_ids = ARRAY[(a.payload #>> '{to,scope,projectId}')::uuid]
    WHERE a.org_id = org.id::uuid AND a.project_ids = '{}'
      AND a.action = 'assignment.granted'
      AND a.payload #>> '{to,scope,type}' = 'project'
      AND a.payload #>> '{to,scope,projectId}' ~* uuid_re;

    UPDATE audit_log a
    SET project_ids = ARRAY[(a.payload #>> '{from,scope,projectId}')::uuid]
    WHERE a.org_id = org.id::uuid AND a.project_ids = '{}'
      AND a.action = 'assignment.revoked'
      AND a.payload #>> '{from,scope,type}' = 'project'
      AND a.payload #>> '{from,scope,projectId}' ~* uuid_re;

    -- 4. Invitation rows (expired included): the project-scope invitation's project ids.
    UPDATE audit_log a
    SET project_ids = i.project_ids
    FROM invitations i
    WHERE a.org_id = org.id::uuid AND a.project_ids = '{}'
      AND a.action LIKE 'invitation.%'
      AND a.target_type = 'invitation'
      AND i.org_id = org.id::uuid
      AND i.scope_type = 'project'
      AND cardinality(i.project_ids) >= 1
      AND i.id = CASE WHEN a.target_id ~* uuid_re THEN a.target_id::uuid END;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;
