-- Hand-written: the invitee's own invitation lookup across orgs, in any status (0029 added `declined`).
-- Runs as agentdesk_owner (table owner).

-- FORCE RLS also binds the definer (agentdesk_owner), so it gets a read-only policy on invitations limited to the
-- one id the function was asked for (a transaction-local setting the function sets and clears), not every row.
-- With no setting the policy matches nothing.
CREATE POLICY "definer_read_lookup" ON "invitations" AS PERMISSIVE FOR SELECT TO agentdesk_owner
  USING (id = nullif(current_setting('agentdesk.invitation_lookup', true), '')::uuid);--> statement-breakpoint

CREATE FUNCTION invitation_org_for_email(p_invitation_id uuid, p_email text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
BEGIN
  PERFORM set_config('agentdesk.invitation_lookup', p_invitation_id::text, true);
  SELECT i.org_id INTO v_org FROM invitations i WHERE i.id = p_invitation_id AND i.email = lower(p_email);
  PERFORM set_config('agentdesk.invitation_lookup', '', true);
  RETURN v_org;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION invitation_org_for_email(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION invitation_org_for_email(uuid, text) TO agentdesk_app;
