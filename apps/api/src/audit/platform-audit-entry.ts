import { platformAuditLog, type Tx } from '@agentdesk/db';
import type { PlatformAuditAction } from '@agentdesk/contracts';
import { redactBody } from './redact-body';

export type { PlatformAuditAction } from '@agentdesk/contracts';

export interface PlatformAuditEntry {
  actorUserId: string;
  action: PlatformAuditAction;
  targetType: 'platform_admin' | 'org' | 'assignment' | 'invitation';
  targetId: string;
  /** The organization the row is about (suspend, reactivate, edit); left out for rows that target no org. */
  targetOrgId?: string;
  payload: Record<string, unknown>;
}

/** The platform_audit_log row; payload = redactBody(payload). */
export function buildPlatformAuditRow(entry: PlatformAuditEntry): typeof platformAuditLog.$inferInsert {
  return {
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ...(entry.targetOrgId === undefined ? {} : { targetOrgId: entry.targetOrgId }),
    payload: redactBody(entry.payload),
  };
}

export async function writePlatformAuditEntry(tx: Tx, entry: PlatformAuditEntry): Promise<void> {
  await tx.insert(platformAuditLog).values(buildPlatformAuditRow(entry));
}
