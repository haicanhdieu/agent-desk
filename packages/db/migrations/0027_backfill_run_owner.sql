-- Hand-written data migration: best-effort backfill of runs.owner_user_id for runs created before RBAC.
-- Runs as agentdesk_owner. A run is owned by the user whose linked account (account.provider_id = the project's
-- board connection provider, account.account_id = runs.triggered_by_external_id) is the run's commenter. A commenter
-- linked to more than one user is ambiguous and left alone, as is every run with no match: those stay owner-less, so
-- only `any` grants control them. Idempotent: only rows with owner_user_id null are touched. Batched per org, keyset on runs.id so runs left
-- owner-less are not re-read; the migrator runs all pending migrations in one transaction, so batches give no lock relief.
DO $$
DECLARE
  org record;
  changed integer;
  last_id uuid;
BEGIN
  FOR org IN
    SELECT id FROM organization
    WHERE id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY id
  LOOP
    PERFORM set_config('app.org_id', org.id, true);
    last_id := NULL;
    LOOP
      WITH candidates AS (
        SELECT r.id, linked.user_id
        FROM runs r
        JOIN projects p ON p.id = r.project_id
        JOIN connections c ON c.id = p.board_connection_id
        CROSS JOIN LATERAL (
          SELECT min(a.user_id) AS user_id
          FROM account a
          WHERE a.provider_id = c.provider AND a.account_id = r.triggered_by_external_id
          HAVING count(DISTINCT a.user_id) = 1
        ) linked
        WHERE r.org_id = org.id::uuid
          AND r.owner_user_id IS NULL
          AND r.triggered_by_external_id IS NOT NULL
          AND (last_id IS NULL OR r.id > last_id)
        ORDER BY r.id
        LIMIT 1000
      ),
      updated AS (
        UPDATE runs
        SET owner_user_id = candidates.user_id
        FROM candidates
        WHERE runs.id = candidates.id AND runs.org_id = org.id::uuid
        RETURNING runs.id
      )
      SELECT count(*), (array_agg(id ORDER BY id DESC))[1] INTO changed, last_id FROM updated;
      EXIT WHEN changed = 0;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;
