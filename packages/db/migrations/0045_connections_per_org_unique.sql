ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_external_id_key";--> statement-breakpoint
ALTER TABLE "inbound_events" DROP CONSTRAINT "inbound_events_provider_delivery_key";--> statement-breakpoint
CREATE INDEX "connections_provider_external_id_idx" ON "connections" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_events_null_org_delivery_key" ON "inbound_events" USING btree ("provider","delivery_id") WHERE "inbound_events"."org_id" is null;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_org_provider_external_id_key" UNIQUE("org_id","provider","external_id");--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_org_provider_delivery_key" UNIQUE("org_id","provider","delivery_id");--> statement-breakpoint

-- Hand-written: one installation can now be linked by several orgs, so the same (provider, external_id, repo_path)
-- can match projects in more than one org. resolve_project returns every match (ADR-0039) and intake handles the
-- event once per match, inside that org. A project's connection must belong to its org, as in 0003. Same hardening
-- as 0003: SECURITY DEFINER owned by agentdesk_owner, pinned search_path, no PUBLIC execute, app role only.
CREATE OR REPLACE FUNCTION resolve_project(p_provider text, p_external_id text, p_repo_path text)
RETURNS TABLE (org_id uuid, project_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.org_id, p.id
  FROM projects p
  JOIN connections c ON c.id IN (p.code_connection_id, p.board_connection_id) AND c.org_id = p.org_id
  WHERE c.provider = p_provider AND c.external_id = p_external_id AND p.repo_path = p_repo_path
  ORDER BY p.created_at, p.id;
$$;--> statement-breakpoint
ALTER FUNCTION resolve_project(text, text, text) OWNER TO agentdesk_owner;--> statement-breakpoint
REVOKE ALL ON FUNCTION resolve_project(text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION resolve_project(text, text, text) TO agentdesk_app;
