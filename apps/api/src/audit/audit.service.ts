import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { auditLog, invitations, user, withOrg, type Db } from '@agentdesk/db';
import { Id, pageWindow, toPage, type AuditEntryDto, type Page, type PageQuery } from '@agentdesk/contracts';
import { DB } from '../db/db.module';
import { loadAllRoles } from '../orgs/roles';
import { toAuditEntry, type AuditLookups } from './audit-view';

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * One page of the org's audit log, newest first (`at desc, id desc`), under `withOrg(orgId)` only. The caller's
   * `audit:read` was decided by the guard before this runs. Actor and user-target names, invitation emails (for
   * invitation targets only) and role names are read in the same transaction; the payload is mapped by `toAuditEntry`
   * and never returned.
   */
  async list(orgId: string, q: PageQuery): Promise<Page<AuditEntryDto>> {
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(eq(auditLog.orgId, orgId));
      const rows = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.orgId, orgId))
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(limit)
        .offset(offset);

      const userIds = new Set<string>();
      const invitationIds = new Set<string>();
      for (const r of rows) {
        if (r.actorUserId !== null) userIds.add(r.actorUserId);
        if (r.targetId === null) continue;
        if (r.targetType === 'user') userIds.add(r.targetId);
        // ids that are not uuids cannot name an invitation, and would fail the uuid comparison
        if (r.targetType === 'invitation' && Id.safeParse(r.targetId).success) invitationIds.add(r.targetId);
      }
      const users =
        userIds.size === 0
          ? []
          : await tx
              .select({ id: user.id, name: user.name, handle: user.handle })
              .from(user)
              .where(inArray(user.id, [...userIds]));
      const emails =
        invitationIds.size === 0
          ? []
          : await tx
              .select({ id: invitations.id, email: invitations.email })
              .from(invitations)
              .where(and(eq(invitations.orgId, orgId), inArray(invitations.id, [...invitationIds])));
      const lookups: AuditLookups = {
        users: new Map(users.map((u) => [u.id, { name: u.name, handle: u.handle ?? u.name }])),
        invitationEmails: new Map(emails.map((e) => [e.id, e.email])),
        roleNames: new Map((await loadAllRoles(tx)).map((r) => [r.key, r.name])),
      };
      return toPage(
        rows.map((r) => toAuditEntry(r, lookups)),
        counted?.total ?? 0,
        q,
      );
    });
  }
}
