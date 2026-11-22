import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Platform admins (ADR-0037). Documented exception to "every table has org_id": platform data, no org, no RLS.
 * Reached only through `scope: 'platform'` routes, `/me/access` and the sign-up gate. The app role may
 * SELECT, INSERT and DELETE; rows are granted or removed, never edited.
 */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    grantedBy: text('granted_by'),
    grantedAt: ts('granted_at').notNull().defaultNow(),
  },
  (t) => [
    unique('platform_admins_email_key').on(t.email),
    check('platform_admins_email_check', sql`${t.email} = lower(btrim(${t.email})) and ${t.email} <> ''`),
  ],
);

/** Append-only platform audit trail (ADR-0037): no org_id, no RLS; the app role may SELECT and INSERT only. */
export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('platform_audit_log_created_at_idx').on(t.createdAt, t.id)],
);
