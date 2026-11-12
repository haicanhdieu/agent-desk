-- Hand-written: FORCE RLS, grants, run numbering trigger and the two cross-tenant functions.
-- Runs as agentdesk_owner (table owner). Roles themselves are created by bootstrapDatabase.

-- 1. FORCE ROW LEVEL SECURITY (ENABLE and the org policies come from 0000).
ALTER TABLE "connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "projects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inbound_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poll_cursors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 2. Grants for the application role (not owner, no BYPASSRLS). better-auth tables carry no org_id and no RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", "session", "account", "verification", "organization", "member", "invitation",
  "connections", "projects", "agents", "rules", "runs", "run_events", "inbound_events", "poll_cursors", "audit_log"
  TO agentdesk_app;--> statement-breakpoint

-- 3. Per-project run numbers: max(number)+1 under a per-project advisory lock, assigned on insert.
CREATE FUNCTION assign_run_number() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.project_id::text));
  SELECT coalesce(max(number), 0) + 1 INTO NEW.number FROM runs WHERE project_id = NEW.project_id;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER runs_assign_number BEFORE INSERT ON "runs"
  FOR EACH ROW EXECUTE FUNCTION assign_run_number();--> statement-breakpoint

-- 4. Cross-tenant functions. FORCE RLS also binds the table owner, so the definer (agentdesk_owner)
--    gets read-only policies on exactly the tables these functions read.
CREATE POLICY "definer_read" ON "connections" AS PERMISSIVE FOR SELECT TO agentdesk_owner USING (true);--> statement-breakpoint
CREATE POLICY "definer_read" ON "projects" AS PERMISSIVE FOR SELECT TO agentdesk_owner USING (true);--> statement-breakpoint
CREATE POLICY "definer_read" ON "runs" AS PERMISSIVE FOR SELECT TO agentdesk_owner USING (true);--> statement-breakpoint

CREATE FUNCTION resolve_project(p_provider text, p_external_id text, p_repo_path text)
RETURNS TABLE (org_id uuid, project_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.org_id, p.id
  FROM projects p
  JOIN connections c ON c.id IN (p.code_connection_id, p.board_connection_id)
  WHERE c.provider = p_provider AND c.external_id = p_external_id AND p.repo_path = p_repo_path
  LIMIT 1;
$$;--> statement-breakpoint

CREATE FUNCTION queued_runs_without_workflow(p_older_than_seconds integer)
RETURNS TABLE (org_id uuid, run_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.org_id, r.id
  FROM runs r
  WHERE r.status = 'queued' AND r.workflow_id IS NULL
    AND r.queued_at < now() - make_interval(secs => p_older_than_seconds);
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION resolve_project(text, text, text) FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION queued_runs_without_workflow(integer) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project(text, text, text) TO agentdesk_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION queued_runs_without_workflow(integer) TO agentdesk_app;
