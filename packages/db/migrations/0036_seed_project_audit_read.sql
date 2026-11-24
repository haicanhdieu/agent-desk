-- Hand-written data migration (issue 191): owner and admin gain project-audit:read. Runs as agentdesk_owner.
-- Idempotent: every insert is `on conflict do nothing`. Never edits 0026; no schema change.
-- New orgs copy the templates, so they follow the catalog.

-- 1. The global template catalog (no org_id, no RLS).
INSERT INTO role_template_permissions (template_id, permission, condition)
SELECT t.id, 'project-audit:read', 'any'
FROM role_templates t
WHERE t.key IN ('owner', 'admin')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 2. The built-in copies in every existing org. role_permissions is a forced-RLS org table, so the org is set
--    transaction-locally for each org before its insert (same shape as 0026 step 2); non-uuid ids are skipped.
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

    INSERT INTO role_permissions (org_id, role_id, permission, condition)
    SELECT r.org_id, r.id, 'project-audit:read', 'any'
    FROM roles r
    WHERE r.org_id = org.id::uuid
      AND r.built_in
      AND r.key IN ('owner', 'admin')
    ON CONFLICT DO NOTHING;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;
