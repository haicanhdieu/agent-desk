import { AuditAction, type AuditActorKind, type AuditChange, type AuditEntryDto } from '@agentdesk/contracts';
import { redactBody } from './redact-body';

/** One stored `audit_log` row as the view reads it. */
export interface AuditRowIn {
  id: string;
  at: Date;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
}

export interface AuditLookups {
  users: Map<string, { name: string; handle: string }>;
  /** invitation id → invitee email; read only for invitation targets */
  invitationEmails: Map<string, string>;
  /** role key → name */
  roleNames: Map<string, string>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((k) => typeof k === 'string');
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function actorKindOf(v: unknown): AuditActorKind | null {
  return v === 'member' || v === 'platform_admin' ? v : null;
}

/** The stored change fields are read defensively: a row written before this slice, or redacted, may lack any of them. */
function changesOf(action: string, payload: Record<string, unknown>, lookups: AuditLookups): AuditChange[] {
  const roleName = (key: string): string => lookups.roleNames.get(key) ?? key;
  const names = (keys: string[]): string | null =>
    keys.length === 0 ? null : [...new Set(keys.map(roleName))].join(', ');
  switch (action) {
    case 'member.role_changed': {
      const from = payload['from'];
      const to = payload['to'];
      const toKey = to === null ? null : str(to);
      if (!isStringArray(from) || (to !== null && toKey === null)) return [];
      return [{ field: 'role', from: names(from), to: toKey === null ? null : roleName(toKey) }];
    }
    case 'org.updated': {
      const from = payload['from'];
      const to = payload['to'];
      if (!isRecord(from) || !isRecord(to)) return [];
      const out: AuditChange[] = [];
      for (const field of ['name', 'slug'] as const) {
        const next = str(to[field]);
        if (next !== null) out.push({ field, from: str(from[field]), to: next });
      }
      return out;
    }
    case 'member.removed': {
      const from = payload['from'];
      if (!Array.isArray(from)) return [];
      const keys = from.flatMap((r) => (isRecord(r) && typeof r['roleKey'] === 'string' ? [r['roleKey']] : []));
      return keys.length === 0 ? [] : [{ field: 'role', from: names(keys), to: null }];
    }
    case 'invitation.created':
    case 'invitation.accepted': {
      const to = payload['to'];
      const key = isRecord(to) ? str(to['roleKey']) : null;
      return key === null ? [] : [{ field: 'role', from: null, to: roleName(key) }];
    }
    default:
      return [];
  }
}

function labelOf(row: AuditRowIn, lookups: AuditLookups): string | null {
  if (row.targetId === null) return null;
  if (row.targetType === 'user') return lookups.users.get(row.targetId)?.name ?? null;
  if (row.targetType === 'invitation') return lookups.invitationEmails.get(row.targetId) ?? null;
  return null;
}

/** Maps a stored row to the DTO, field by field: the payload (redacted again here) never leaves this function. */
export function toAuditEntry(row: AuditRowIn, lookups: AuditLookups): AuditEntryDto {
  const payload = redactBody(row.payload);
  const actor = row.actorUserId === null ? undefined : lookups.users.get(row.actorUserId);
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor:
      row.actorUserId !== null && actor ? { userId: row.actorUserId, name: actor.name, handle: actor.handle } : null,
    // Only a typed audit entry carries a trusted actorKind: the interceptor stores the raw request body of any other
    // row, so a member could forge the key there.
    actorKind: AuditAction.safeParse(row.action).success ? actorKindOf(payload['actorKind']) : null,
    action: row.action,
    target: { type: row.targetType, id: row.targetId, label: labelOf(row, lookups) },
    changes: changesOf(row.action, payload, lookups),
  };
}
