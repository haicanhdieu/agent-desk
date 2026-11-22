import { platformAuditLog, type Tx } from '@agentdesk/db';
import { redactBody } from './redact-body';

export type PlatformAuditAction = 'platform_admin.granted' | 'platform_admin.revoked';

export interface PlatformAuditEntry {
  actorUserId: string;
  action: PlatformAuditAction;
  targetType: 'platform_admin';
  targetId: string;
  payload: { email: string; userId: string | null };
}

/** The platform_audit_log row; payload = redactBody(payload). */
export function buildPlatformAuditRow(entry: PlatformAuditEntry): typeof platformAuditLog.$inferInsert {
  return {
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    payload: redactBody(entry.payload),
  };
}

export async function writePlatformAuditEntry(tx: Tx, entry: PlatformAuditEntry): Promise<void> {
  await tx.insert(platformAuditLog).values(buildPlatformAuditRow(entry));
}
