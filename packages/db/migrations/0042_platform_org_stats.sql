-- Hand-written: the platform directory's per-org stats across tenants (platform admin dashboard spec).
-- Runs as agentdesk_owner (table owner). Returns ids, counts and timestamps only, never ticket, run or comment text.

-- FORCE RLS also binds the definer (agentdesk_owner), so it gets read-only policies limited to the rows the
-- function reads: the org-scope owner assignments and the role rows with key 'owner'. (projects and runs already have
-- the definer_read policies from 0001.) Without an org context nothing else is visible to the owner.
CREATE POLICY "platform_stats_read" ON "role_assignments" AS PERMISSIVE FOR SELECT TO agentdesk_owner
  USING (scope_type = 'org' AND role_id IN (SELECT id FROM roles WHERE key = 'owner'));--> statement-breakpoint
CREATE POLICY "platform_stats_read" ON "roles" AS PERMISSIVE FOR SELECT TO agentdesk_owner
  USING (key = 'owner');--> statement-breakpoint

CREATE FUNCTION platform_org_stats(p_org_ids uuid[])
RETURNS TABLE (org_id uuid, project_count integer, last_activity_at timestamptz, owner_user_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(cardinality(p_org_ids), 0) > 100 THEN
    RAISE EXCEPTION 'platform_org_stats accepts at most 100 org ids';
  END IF;
  RETURN QUERY
  SELECT o.id::uuid,
    (SELECT count(*)::integer FROM projects p WHERE p.org_id = o.id::uuid),
    (SELECT max(r.queued_at) FROM runs r WHERE r.org_id = o.id::uuid),
    (SELECT ra.user_id
       FROM role_assignments ra
       JOIN roles ro ON ro.org_id = ra.org_id AND ro.id = ra.role_id
      WHERE ra.org_id = o.id::uuid AND ra.scope_type = 'org' AND ro.key = 'owner'
      ORDER BY ra.granted_at ASC, ra.id ASC
      LIMIT 1)
  FROM organization o
  WHERE o.id = ANY (p_org_ids::text[]);
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION platform_org_stats(uuid[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_org_stats(uuid[]) TO agentdesk_app;
