-- Hand-written data migration for multiple agent configurations. Runs as agentdesk_owner, which forced RLS binds, so
-- app.org_id is set per org (as 0027 does). Per project, in id order (one project per batch):
--   1. a legacy agent whose name differs from an older agent's only by case gets " (2)" (or the next free number), so
--      the case-insensitive unique index of 0049 can be built;
--   2. a project with agents and no default agent gets its oldest agent as the default, and the project's five limits
--      take that agent's five (the old columns on agents stay, unread by the new code).
-- Idempotent: a project that has a default is skipped, and a second pass finds no case-only duplicates. No row is
-- deleted, and model, address, credential reference, max turns, rules and runs are not touched.
DO $$
DECLARE
  org record;
  proj record;
  dup record;
  suffix integer;
  oldest record;
BEGIN
  FOR org IN
    SELECT id FROM organization
    WHERE id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY id
  LOOP
    PERFORM set_config('app.org_id', org.id, true);
    FOR proj IN SELECT p.id FROM projects p WHERE p.org_id = org.id::uuid ORDER BY p.id LOOP
      FOR dup IN
        SELECT id, name FROM (
          SELECT a.id, a.name,
                 row_number() OVER (PARTITION BY lower(a.name) ORDER BY a.created_at, a.id) AS rn
          FROM agents a
          WHERE a.project_id = proj.id AND a.org_id = org.id::uuid
        ) ranked
        WHERE rn > 1
        ORDER BY id
      LOOP
        suffix := 2;
        WHILE EXISTS (
          SELECT 1 FROM agents a
          WHERE a.project_id = proj.id AND a.org_id = org.id::uuid
            AND lower(a.name) = lower(dup.name || ' (' || suffix || ')')
        ) LOOP
          suffix := suffix + 1;
        END LOOP;
        UPDATE agents SET name = dup.name || ' (' || suffix || ')'
        WHERE id = dup.id AND org_id = org.id::uuid;
      END LOOP;

      IF NOT EXISTS (
        SELECT 1 FROM agents a WHERE a.project_id = proj.id AND a.org_id = org.id::uuid AND a.is_default
      ) THEN
        SELECT a.id, a.timeout_seconds, a.paused_keep_seconds, a.done_keep_seconds, a.idle_end_seconds, a.auto_resume_max
        INTO oldest
        FROM agents a
        WHERE a.project_id = proj.id AND a.org_id = org.id::uuid
        ORDER BY a.created_at, a.id
        LIMIT 1;
        IF FOUND THEN
          UPDATE agents SET is_default = true WHERE id = oldest.id AND org_id = org.id::uuid;
          UPDATE projects
          SET timeout_seconds = oldest.timeout_seconds,
              paused_keep_seconds = oldest.paused_keep_seconds,
              done_keep_seconds = oldest.done_keep_seconds,
              idle_end_seconds = oldest.idle_end_seconds,
              auto_resume_max = oldest.auto_resume_max
          WHERE id = proj.id AND org_id = org.id::uuid;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;
