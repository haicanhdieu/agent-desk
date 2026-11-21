import { auditLog, type Tx } from '@agentdesk/db';
import { redactBody } from './redact-body';

export type AuditAction =
  | 'assignment.granted'
  | 'assignment.revoked'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'invitation.expired'
  | 'invitation.accepted'
  | 'invitation.declined'
  | 'invitation.resent'
  | 'org.created';

export interface AuditEntry {
  orgId: string;
  actorUserId: string;
  actorKind?: 'member' | 'platform_admin';
  action: AuditAction;
  targetType: 'user' | 'invitation' | 'org';
  targetId: string;
  payload: Record<string, unknown>;
}

/** The audit_log row; payload = redactBody({ ...payload, actorKind }) (actorKind left out when undefined). */
export function buildAuditRow(entry: AuditEntry): typeof auditLog.$inferInsert {
  const payload = entry.actorKind === undefined ? entry.payload : { ...entry.payload, actorKind: entry.actorKind };
  return {
    orgId: entry.orgId,
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    payload: redactBody(payload),
  };
}

export async function writeAuditEntry(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values(buildAuditRow(entry));
}
