import {
  AuditAction,
  can,
  visibleProjects,
  type Access,
  type AuditActorKind,
  type AuditChange,
  type AuditEntryDto,
} from '@agentdesk/contracts';
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
  /** `audit_log.project_ids`: the projects the row belongs to. */
  projectIds: string[];
}

export interface AuditLookups {
  users: Map<string, { name: string; handle: string }>;
  /** invitation id → invitee email; read only for invitation targets */
  invitationEmails: Map<string, string>;
  /** role key → name */
  roleNames: Map<string, string>;
  /** project id → name, for the projects of the org that still exist */
  projectNames: Map<string, string>;
}

/** What the reader of an audit page may see on invitation rows (same test as `visibilityFilter` in invitations.service). */
export interface AuditViewer {
  /** The invitee email: `member:read` at org scope, or `assignment:read` on every project of a non-empty list. */
  emailFor(projectIds: readonly string[]): boolean;
  /** The project's name may be shown: it is in `visibleProjects(access, 'project:read')`. */
  seesProject(projectId: string): boolean;
}

export function auditViewerOf(access: Access): AuditViewer {
  const orgReader = can(access, 'member:read');
  const visible = visibleProjects(access, 'project:read');
  return {
    // An empty list is an org-scope invitation: only an org-level reader sees that email, never a project grant.
    emailFor: (projectIds) =>
      orgReader ||
      (projectIds.length > 0 && projectIds.every((projectId) => can(access, 'assignment:read', { projectId }))),
    seesProject: (projectId) => visible === 'all' || visible.includes(projectId),
  };
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
    case 'org.suspended':
    case 'org.reactivated': {
      const from = str(payload['from']);
      const to = str(payload['to']);
      return from === null || to === null ? [] : [{ field: 'status', from, to }];
    }
    case 'member.removed': {
      const from = payload['from'];
      if (!Array.isArray(from)) return [];
      const keys = from.flatMap((r) => (isRecord(r) && typeof r['roleKey'] === 'string' ? [r['roleKey']] : []));
      return keys.length === 0 ? [] : [{ field: 'role', from: names(keys), to: null }];
    }
    case 'assignment.granted': {
      const to = payload['to'];
      const key = isRecord(to) ? str(to['roleKey']) : null;
      return key === null ? [] : [{ field: 'role', from: null, to: roleName(key) }];
    }
    case 'project_member.role_changed': {
      const from = payload['from'];
      const to = str(payload['to']);
      if (!isStringArray(from) || to === null) return [];
      return [{ field: 'role', from: names(from), to: roleName(to) }];
    }
    case 'project_member.removed': {
      const from = payload['from'];
      return isStringArray(from) && from.length > 0 ? [{ field: 'role', from: names(from), to: null }] : [];
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

function labelOf(row: AuditRowIn, lookups: AuditLookups, viewer: AuditViewer): string | null {
  if (row.targetId === null) return null;
  if (row.targetType === 'user') return lookups.users.get(row.targetId)?.name ?? null;
  if (row.targetType === 'invitation') {
    return viewer.emailFor(row.projectIds) ? (lookups.invitationEmails.get(row.targetId) ?? null) : null;
  }
  return null;
}

/** Invitation rows only: the listed projects that still exist and the viewer may see, by name then id. */
function projectsOf(row: AuditRowIn, lookups: AuditLookups, viewer: AuditViewer): AuditEntryDto['projects'] {
  if (!row.action.startsWith('invitation.')) return [];
  return [...new Set(row.projectIds)]
    .flatMap((id) => {
      const name = lookups.projectNames.get(id);
      return name !== undefined && viewer.seesProject(id) ? [{ id, name }] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Maps a stored row to the DTO, field by field: the payload (redacted again here) never leaves this function. */
export function toAuditEntry(row: AuditRowIn, lookups: AuditLookups, viewer: AuditViewer): AuditEntryDto {
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
    target: { type: row.targetType, id: row.targetId, label: labelOf(row, lookups, viewer) },
    changes: changesOf(row.action, payload, lookups),
    projects: projectsOf(row, lookups, viewer),
  };
}
