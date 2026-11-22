-- Hand-written data migration (issue 216): member and viewer lose the four Desk configuration reads
-- (agent:read, skill:read, rule:read, setup:read). Runs as agentdesk_owner. Idempotent: every statement is a delete.
-- Never edits 0026; owner and admin keep all four. New orgs copy the templates, so they follow the catalog.

-- 1. The global template catalog (no org_id, no RLS).
DELETE FROM role_template_permissions
WHERE permission IN ('agent:read', 'skill:read', 'rule:read', 'setup:read')
  AND template_id IN (SELECT id FROM role_templates WHERE key IN ('member', 'viewer'));--> statement-breakpoint

-- 2. The built-in copies in every existing org. role_permissions is a forced-RLS org table, so the org is set
--    transaction-locally for each org before its delete (same shape as 0026 step 2); non-uuid ids are skipped.
DO $$
DECLARE
  org record;
BEGIN
  FOR org IN
    SELECT id FROM organization
    WHERE id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY id
  LOOP
    PERFORM set_config('app.org_id', org.id, true);

    DELETE FROM role_permissions rp
    USING roles r
    WHERE rp.role_id = r.id
      AND r.org_id = org.id::uuid
      AND r.built_in
      AND r.key IN ('member', 'viewer')
      AND rp.permission IN ('agent:read', 'skill:read', 'rule:read', 'setup:read');
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;
