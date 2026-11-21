-- Hand-written data migration: the built-in role templates and their copy into every existing org.
-- Runs as agentdesk_owner. Idempotent: every insert is `on conflict do nothing`.
-- Platform permissions (`platform-*`) never appear here: tenant roles cannot hold them.

-- 1. The global template catalog (no org_id, no RLS; read-only to the app role).
INSERT INTO role_templates (key, name, assignable_scopes) VALUES
  ('owner', 'Owner', '{org}'),
  ('admin', 'Admin', '{org,project}'),
  ('member', 'Member', '{org,project}'),
  ('viewer', 'Viewer', '{org,project}')
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint

INSERT INTO role_template_permissions (template_id, permission, condition)
SELECT t.id, v.permission, v.condition
FROM (VALUES
    ('owner', 'project:create', 'any'),
    ('owner', 'project:read', 'any'),
    ('owner', 'project:update', 'any'),
    ('owner', 'project:delete', 'any'),
    ('owner', 'connection:create', 'any'),
    ('owner', 'connection:read', 'any'),
    ('owner', 'agent:read', 'any'),
    ('owner', 'agent:update', 'any'),
    ('owner', 'secret:update', 'any'),
    ('owner', 'skill:read', 'any'),
    ('owner', 'skill:update', 'any'),
    ('owner', 'skill:delete', 'any'),
    ('owner', 'rule:create', 'any'),
    ('owner', 'rule:read', 'any'),
    ('owner', 'rule:update', 'any'),
    ('owner', 'rule:delete', 'any'),
    ('owner', 'setup:read', 'any'),
    ('owner', 'setup:update', 'any'),
    ('owner', 'setup:test', 'any'),
    ('owner', 'run:read', 'any'),
    ('owner', 'run:create', 'any'),
    ('owner', 'run:update', 'any'),
    ('owner', 'run:cancel', 'any'),
    ('owner', 'terminal:attach', 'any'),
    ('owner', 'member:read', 'any'),
    ('owner', 'member:create', 'any'),
    ('owner', 'member:update', 'any'),
    ('owner', 'member:delete', 'any'),
    ('owner', 'assignment:read', 'any'),
    ('owner', 'assignment:create', 'any'),
    ('owner', 'assignment:delete', 'any'),
    ('owner', 'org:update', 'any'),
    ('owner', 'org:delete', 'any'),
    ('admin', 'project:create', 'any'),
    ('admin', 'project:read', 'any'),
    ('admin', 'project:update', 'any'),
    ('admin', 'project:delete', 'any'),
    ('admin', 'connection:create', 'any'),
    ('admin', 'connection:read', 'any'),
    ('admin', 'agent:read', 'any'),
    ('admin', 'agent:update', 'any'),
    ('admin', 'secret:update', 'any'),
    ('admin', 'skill:read', 'any'),
    ('admin', 'skill:update', 'any'),
    ('admin', 'skill:delete', 'any'),
    ('admin', 'rule:create', 'any'),
    ('admin', 'rule:read', 'any'),
    ('admin', 'rule:update', 'any'),
    ('admin', 'rule:delete', 'any'),
    ('admin', 'setup:read', 'any'),
    ('admin', 'setup:update', 'any'),
    ('admin', 'setup:test', 'any'),
    ('admin', 'run:read', 'any'),
    ('admin', 'run:create', 'any'),
    ('admin', 'run:update', 'any'),
    ('admin', 'run:cancel', 'any'),
    ('admin', 'terminal:attach', 'any'),
    ('admin', 'member:read', 'any'),
    ('admin', 'member:create', 'any'),
    ('admin', 'member:update', 'any'),
    ('admin', 'member:delete', 'any'),
    ('admin', 'assignment:read', 'any'),
    ('admin', 'assignment:create', 'any'),
    ('admin', 'assignment:delete', 'any'),
    ('admin', 'org:update', 'any'),
    ('member', 'project:read', 'any'),
    ('member', 'agent:read', 'any'),
    ('member', 'skill:read', 'any'),
    ('member', 'rule:read', 'any'),
    ('member', 'setup:read', 'any'),
    ('member', 'run:read', 'any'),
    ('member', 'run:create', 'any'),
    ('member', 'run:update', 'own'),
    ('member', 'run:cancel', 'own'),
    ('member', 'terminal:attach', 'own'),
    ('viewer', 'project:read', 'any'),
    ('viewer', 'agent:read', 'any'),
    ('viewer', 'skill:read', 'any'),
    ('viewer', 'rule:read', 'any'),
    ('viewer', 'setup:read', 'any'),
    ('viewer', 'run:read', 'any')
) AS v(key, permission, condition)
JOIN role_templates t ON t.key = v.key
ON CONFLICT (template_id, permission) DO NOTHING;--> statement-breakpoint

-- 2. Copy the templates into every existing org. roles and role_permissions are forced-RLS org tables, so the
--    org is set transaction-locally for each org before its inserts. organization.id is text; only uuid-shaped
--    ids can be an app org (org_id is uuid), so anything else is skipped rather than failing the cast.
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

    INSERT INTO roles (org_id, key, name, built_in, template_id, assignable_scopes)
    SELECT org.id::uuid, t.key, t.name, true, t.id, t.assignable_scopes
    FROM role_templates t
    ON CONFLICT (org_id, key) DO NOTHING;

    INSERT INTO role_permissions (org_id, role_id, permission, condition)
    SELECT org.id::uuid, r.id, tp.permission, tp.condition
    FROM roles r
    JOIN role_template_permissions tp ON tp.template_id = r.template_id
    WHERE r.org_id = org.id::uuid AND r.built_in
    ON CONFLICT (role_id, permission) DO NOTHING;
  END LOOP;
  PERFORM set_config('app.org_id', '', true);
END
$$;
