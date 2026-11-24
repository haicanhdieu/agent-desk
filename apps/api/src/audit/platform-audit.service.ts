import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { organization, platformAuditLog, user, type Db } from '@agentdesk/db';
import {
  pageWindow,
  PlatformAuditAction,
  toPage,
  type AuditChange,
  type Page,
  type PlatformAuditEntryDto,
  type PlatformAuditListQuery,
} from '@agentdesk/contracts';
import { DB } from '../db/db.module';
import { redactBody } from './redact-body';

type Row = typeof platformAuditLog.$inferSelect;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/**
 * What a row changed, read defensively, only strings: the old and new name and slug of an `org.updated` row, and the
 * role key of a role given (`assignment.granted`, `invitation.created`) or taken (`assignment.revoked`), so the
 * sentence can name the role. No other action carries changes.
 */
function changesOf(action: PlatformAuditAction, payload: Record<string, unknown>): AuditChange[] {
  if (action === 'assignment.granted' || action === 'invitation.created') {
    const role = str(payload['roleKey']);
    return role === null ? [] : [{ field: 'role', from: null, to: role }];
  }
  if (action === 'assignment.revoked') {
    const role = str(payload['roleKey']);
    return role === null ? [] : [{ field: 'role', from: role, to: null }];
  }
  if (action !== 'org.updated') return [];
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

/** The suspend or reactivate reason; no other action shows one. */
function reasonOf(action: PlatformAuditAction, payload: Record<string, unknown>): string | null {
  return action === 'org.suspended' || action === 'org.reactivated' ? str(payload['reason']) : null;
}

@Injectable()
export class PlatformAuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * One page of the platform audit trail, newest first (`created_at desc, id desc`), optionally of one org and/or
   * action. The caller's `platform-audit:read` was decided by the guard before this runs. Plain `db.orm`: the table
   * has no org scope. The actor and the org name are left joins (null when the account or org is gone); the target
   * label is built here from the stored payload, which is redacted again and never returned.
   */
  async list(q: PlatformAuditListQuery): Promise<Page<PlatformAuditEntryDto>> {
    const { limit, offset } = pageWindow(q);
    // only actions the contract knows: the count and the page then agree, and no row is dropped after paging
    const filters: SQL[] = [inArray(platformAuditLog.action, PlatformAuditAction.options)];
    if (q.orgId !== undefined) filters.push(eq(platformAuditLog.targetOrgId, q.orgId));
    if (q.action !== undefined) filters.push(eq(platformAuditLog.action, q.action));
    const where = and(...filters);

    const [counted] = await this.db.orm
      .select({ total: sql<number>`count(*)::int` })
      .from(platformAuditLog)
      .where(where);
    const rows = await this.db.orm
      .select({
        row: platformAuditLog,
        actorName: user.name,
        actorHandle: user.handle,
        orgName: organization.name,
      })
      .from(platformAuditLog)
      .leftJoin(user, eq(user.id, platformAuditLog.actorUserId))
      // organization.id is text (better-auth), target_org_id a uuid: compare as text
      .leftJoin(organization, sql`${organization.id} = ${platformAuditLog.targetOrgId}::text`)
      .where(where)
      .orderBy(desc(platformAuditLog.createdAt), desc(platformAuditLog.id))
      .limit(limit)
      .offset(offset);

    // member names of assignment rows, in one query
    const memberIds = new Set<string>();
    for (const r of rows) {
      const id = r.row.action.startsWith('assignment.') ? str(redactBody(asRecord(r.row.payload))['userId']) : null;
      if (id !== null) memberIds.add(id);
    }
    const members =
      memberIds.size === 0
        ? []
        : await this.db.orm
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, [...memberIds]));
    const memberNames = new Map(members.map((m) => [m.id, m.name]));

    const items = rows.flatMap((r) => {
      const action = PlatformAuditAction.safeParse(r.row.action);
      if (!action.success) return [];
      return [toEntry(r.row, action.data, r.actorName, r.actorHandle, r.orgName, memberNames)];
    });
    return toPage(items, counted?.total ?? 0, q);
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {};
}

function labelOf(
  row: Row,
  payload: Record<string, unknown>,
  orgName: string | null,
  memberNames: Map<string, string>,
): string | null {
  switch (row.targetType) {
    case 'platform_admin':
    case 'invitation':
      return str(payload['email']);
    case 'org':
      return orgName ?? str(payload['name']);
    case 'assignment': {
      const userId = str(payload['userId']);
      return userId === null ? null : (memberNames.get(userId) ?? null);
    }
    default:
      return null;
  }
}

/** Maps a stored row to the DTO field by field: the payload (redacted again here) never leaves this function. */
function toEntry(
  row: Row,
  action: PlatformAuditAction,
  actorName: string | null,
  actorHandle: string | null,
  orgName: string | null,
  memberNames: Map<string, string>,
): PlatformAuditEntryDto {
  const payload = redactBody(asRecord(row.payload));
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    actor:
      row.actorUserId !== null && actorName !== null
        ? { userId: row.actorUserId, name: actorName, handle: actorHandle }
        : null,
    action,
    target: { type: row.targetType, id: row.targetId, label: labelOf(row, payload, orgName, memberNames) },
    org: row.targetOrgId !== null && orgName !== null ? { id: row.targetOrgId, name: orgName } : null,
    reason: reasonOf(action, payload),
    changes: changesOf(action, payload),
  };
}
