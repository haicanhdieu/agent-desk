CREATE INDEX IF NOT EXISTS "projects_board_connection_idx" ON "projects" USING btree ("board_connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rules_agent_idx" ON "rules" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_agent_idx" ON "runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runs_inbound_event_idx" ON "runs" USING btree ("inbound_event_id");--> statement-breakpoint

-- Hand-written: resolve_project also requires the connection to belong to the project's org, so a project row
-- pointing at another tenant's connection can never be resolved through it. Same hardening as 0001:
-- SECURITY DEFINER owned by agentdesk_owner, pinned search_path, no PUBLIC execute, app role only.
CREATE OR REPLACE FUNCTION resolve_project(p_provider text, p_external_id text, p_repo_path text)
RETURNS TABLE (org_id uuid, project_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.org_id, p.id
  FROM projects p
  JOIN connections c ON c.id IN (p.code_connection_id, p.board_connection_id) AND c.org_id = p.org_id
  WHERE c.provider = p_provider AND c.external_id = p_external_id AND p.repo_path = p_repo_path
  LIMIT 1;
$$;--> statement-breakpoint
ALTER FUNCTION resolve_project(text, text, text) OWNER TO agentdesk_owner;--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_project(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project(text, text, text) TO agentdesk_app;
