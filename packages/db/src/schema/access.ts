import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './app';
import { user } from './auth';

const orgMatch = sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`;
const orgPolicy = () =>
  pgPolicy('org_isolation', { as: 'permissive', for: 'all', using: orgMatch, withCheck: orgMatch });

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Platform-owned catalog of role templates, copied into every org. Documented exception to "every table has
 * org_id": it holds no tenant data, has no RLS, and the app role can only read it.
 */
export const roleTemplates = pgTable('role_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique('role_templates_key_key'),
  name: text('name').notNull(),
  assignableScopes: text('assignable_scopes').array().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const roleTemplatePermissions = pgTable(
  'role_template_permissions',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => roleTemplates.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    condition: text('condition').notNull().default('any'),
  },
  (t) => [
    primaryKey({ name: 'role_template_permissions_pkey', columns: [t.templateId, t.permission] }),
    check('role_template_permissions_condition_check', sql`${t.condition} in ('any','own')`),
  ],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    builtIn: boolean('built_in').notNull().default(false),
    templateId: uuid('template_id').references(() => roleTemplates.id, { onDelete: 'set null' }),
    assignableScopes: text('assignable_scopes').array().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('roles_org_id_key_key').on(t.orgId, t.key),
    unique('roles_org_id_id_key').on(t.orgId, t.id),
    index('roles_template_id_idx').on(t.templateId),
    orgPolicy(),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    orgId: uuid('org_id').notNull(),
    roleId: uuid('role_id').notNull(),
    /** Parsed against the contracts Permission enum on read; no CHECK, no permissions table. */
    permission: text('permission').notNull(),
    condition: text('condition').notNull().default('any'),
  },
  (t) => [
    primaryKey({ name: 'role_permissions_pkey', columns: [t.roleId, t.permission] }),
    foreignKey({
      name: 'role_permissions_org_role_fkey',
      columns: [t.orgId, t.roleId],
      foreignColumns: [roles.orgId, roles.id],
    }).onDelete('cascade'),
    index('role_permissions_org_idx').on(t.orgId),
    check('role_permissions_condition_check', sql`${t.condition} in ('any','own')`),
    orgPolicy(),
  ],
);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    scopeType: text('scope_type').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    grantedBy: text('granted_by'),
    grantedAt: ts('granted_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'role_assignments_org_role_fkey',
      columns: [t.orgId, t.roleId],
      foreignColumns: [roles.orgId, roles.id],
    }).onDelete('restrict'),
    unique('role_assignments_org_user_role_project_key')
      .on(t.orgId, t.userId, t.roleId, t.projectId)
      .nullsNotDistinct(),
    index('role_assignments_org_user_idx').on(t.orgId, t.userId),
    index('role_assignments_user_id_idx').on(t.userId),
    index('role_assignments_project_idx').on(t.projectId),
    index('role_assignments_org_role_idx').on(t.orgId, t.roleId),
    // Matches the assignments list ORDER BY (granted_at desc, id asc).
    index('role_assignments_org_granted_idx').on(t.orgId, t.grantedAt.desc().nullsFirst(), t.id),
    check('role_assignments_scope_type_check', sql`${t.scopeType} in ('org','project')`),
    check(
      'role_assignments_scope_check',
      sql`(${t.scopeType} = 'org' and ${t.projectId} is null) or (${t.scopeType} = 'project' and ${t.projectId} is not null)`,
    ),
    orgPolicy(),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    /** Lowercased by the service. */
    email: text('email').notNull(),
    roleId: uuid('role_id').notNull(),
    scopeType: text('scope_type').notNull(),
    projectIds: uuid('project_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: text('status').notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    invitedBy: text('invited_by').notNull(),
    acceptedBy: text('accepted_by'),
    acceptedAt: ts('accepted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'invitations_org_role_fkey',
      columns: [t.orgId, t.roleId],
      foreignColumns: [roles.orgId, roles.id],
    }).onDelete('restrict'),
    uniqueIndex('invitations_org_email_pending_key')
      .on(t.orgId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index('invitations_email_pending_idx')
      .on(t.email)
      .where(sql`${t.status} = 'pending'`),
    index('invitations_org_role_idx').on(t.orgId, t.roleId),
    // Matches the invitations list ORDER BY (created_at desc, id desc).
    index('invitations_org_created_idx').on(t.orgId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    check('invitations_scope_type_check', sql`${t.scopeType} in ('org','project')`),
    check('invitations_status_check', sql`${t.status} in ('pending','accepted','declined','revoked','expired')`),
    check(
      'invitations_scope_check',
      sql`(${t.scopeType} = 'org' and ${t.projectIds} = '{}') or (${t.scopeType} = 'project' and cardinality(${t.projectIds}) >= 1)`,
    ),
    orgPolicy(),
  ],
);
