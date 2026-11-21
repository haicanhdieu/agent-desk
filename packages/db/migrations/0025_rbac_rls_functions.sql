-- Hand-written: FORCE RLS, grants and the invitation lookup function for the RBAC tables (0022).
-- Runs as agentdesk_owner (table owner).

-- 1. FORCE ROW LEVEL SECURITY binds the owner too (ENABLE and the org policies come from 0022).
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- 2. Grants for the application role. Roles and their permission lines are copied at org creation and
--    never edited in this slice, so the app gets no UPDATE or DELETE on them (fail closed). The role
--    template catalog is platform-owned and read-only to the app.
GRANT SELECT, INSERT ON "roles", "role_permissions" TO agentdesk_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "role_assignments", "invitations" TO agentdesk_app;--> statement-breakpoint
GRANT SELECT ON "role_templates", "role_template_permissions" TO agentdesk_app;--> statement-breakpoint

-- 3. Sign-up gate and acceptance: pending, unexpired invitations for an email across orgs, ids only.
--    FORCE RLS also binds the definer (agentdesk_owner), so it gets a read-only policy on invitations,
--    limited to the rows the function may return (pending and unexpired), not every invitation.
CREATE POLICY "definer_read" ON "invitations" AS PERMISSIVE FOR SELECT TO agentdesk_owner
  USING (status = 'pending' AND expires_at > now());--> statement-breakpoint

CREATE FUNCTION pending_invitations_for_email(p_email text)
RETURNS TABLE (id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.id, i.org_id
  FROM invitations i
  WHERE i.status = 'pending' AND i.expires_at > now() AND i.email = lower(p_email);
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION pending_invitations_for_email(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION pending_invitations_for_email(text) TO agentdesk_app;
