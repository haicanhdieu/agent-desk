import { z } from 'zod';
import { Id, Timestamp } from './common';

export const AuditAction = z.enum([
  'assignment.granted',
  'assignment.revoked',
  'invitation.created',
  'invitation.revoked',
  'invitation.expired',
  'invitation.accepted',
  'invitation.declined',
  'invitation.resent',
  'org.created',
  'member.role_changed',
  'member.removed',
  'org.updated',
  'org.suspended',
  'org.reactivated',
  'project_member.role_changed',
  'project_member.removed',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditChange = z.object({
  field: z.enum(['role', 'name', 'slug', 'status']),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type AuditChange = z.infer<typeof AuditChange>;

export const AuditActorKind = z.enum(['member', 'platform_admin']);
export type AuditActorKind = z.infer<typeof AuditActorKind>;

export const AuditProjectRef = z.object({ id: Id, name: z.string() });
export type AuditProjectRef = z.infer<typeof AuditProjectRef>;

/** No raw payload: the API maps the stored payload to `changes` and never returns it. */
export const AuditEntryDto = z.object({
  id: Id,
  at: Timestamp,
  actor: z.object({ userId: z.string(), name: z.string(), handle: z.string() }).nullable(),
  actorKind: AuditActorKind.nullable(),
  action: z.string(),
  target: z.object({ type: z.string().nullable(), id: z.string().nullable(), label: z.string().nullable() }),
  changes: z.array(AuditChange),
  projects: z.array(AuditProjectRef),
});
export type AuditEntryDto = z.infer<typeof AuditEntryDto>;
