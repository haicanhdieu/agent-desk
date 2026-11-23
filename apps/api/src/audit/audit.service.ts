import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { auditLog, invitations, projects, user, withOrg, type Db } from '@agentdesk/db';
import {
  Id,
  pageWindow,
  toPage,
  type Access,
  type AuditEntryDto,
  type Page,
  type PageQuery,
} from '@agentdesk/contracts';
import { DB } from '../db/db.module';
import { loadAllRoles } from '../orgs/roles';
import { auditViewerOf, toAuditEntry, type AuditLookups } from './audit-view';

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * One page of the org's audit log, newest first (`at desc, id desc`), under `withOrg(orgId)` only. The caller's
   * `audit:read` was decided by the guard before this runs; `access` shapes what invitation rows show (see `page`).
   */
  list(access: Access, orgId: string, q: PageQuery): Promise<Page<AuditEntryDto>> {
    return this.page(access, orgId, q, eq(auditLog.orgId, orgId));
  }

  /**
   * One page of the rows matching `where` (the caller scopes it to `orgId`), newest first, under `withOrg(orgId)`.
   * Actor and user-target names, invitation emails (for invitation targets only), role names and the names of the
   * listed projects are read in the same transaction; invitee emails and project names are limited to what `access`
   * may see; the payload is mapped by `toAuditEntry` and never returned.
   */
  private async page(access: Access, orgId: string, q: PageQuery, where: SQL): Promise<Page<AuditEntryDto>> {
    const { limit, offset } = pageWindow(q);
    const viewer = auditViewerOf(access);
    return withOrg(this.db, orgId, async (tx) => {
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where);
      const rows = await tx
        .select()
        .from(auditLog)
        .where(where)
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
      const projectIds = [...new Set(rows.flatMap((r) => r.projectIds))];
      const named =
        projectIds.length === 0
          ? []
          : await tx
              .select({ id: projects.id, name: projects.name })
              .from(projects)
              .where(and(eq(projects.orgId, orgId), inArray(projects.id, projectIds)));
      const lookups: AuditLookups = {
        projectNames: new Map(named.map((p) => [p.id, p.name])),
        users: new Map(users.map((u) => [u.id, { name: u.name, handle: u.handle ?? u.name }])),
        invitationEmails: new Map(emails.map((e) => [e.id, e.email])),
        roleNames: new Map((await loadAllRoles(tx)).map((r) => [r.key, r.name])),
      };
      return toPage(
        rows.map((r) => toAuditEntry(r, lookups, viewer)),
        counted?.total ?? 0,
        q,
      );
    });
  }
}
