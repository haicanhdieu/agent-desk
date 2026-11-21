import { Inject, Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  invitationOrgForEmail,
  invitations,
  organization,
  pendingInvitationsForEmail,
  user as userTable,
  withOrg,
  type Db,
  type Tx,
} from '@agentdesk/db';
import {
  InvitationStatus,
  slicePage,
  type AcceptInvitationResponse,
  type MyInvitationDto,
  type Page,
  type PageQuery,
} from '@agentdesk/contracts';
import type { SessionUser } from '../access/session-user';
import { writeAuditEntry } from '../audit/audit-entry';
import { acceptInvitationInTx } from '../auth/accept-invitations';
import { LOGGER } from '../common/logger';
import { requestContext } from '../common/request-context';
import { DB } from '../db/db.module';
import { toInviterDto } from './inviter';
import { effectiveStatus, projectRefs, roleRefs } from './invitations.service';

const NOT_FOUND = 'Not found';

/** The invitee's own invitations, matched on their verified account email (lowercased in SQL), never on the id alone. */
@Injectable()
export class MyInvitationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Pending, unexpired invitations across orgs, newest first. An unverified email proves nothing: an empty page. */
  async list(user: SessionUser, q: PageQuery): Promise<Page<MyInvitationDto>> {
    if (!user.emailVerified) return slicePage([], q);
    const pending = await pendingInvitationsForEmail(this.db, user.email);
    const byOrg = new Map<string, string[]>();
    for (const p of pending) byOrg.set(p.orgId, [...(byOrg.get(p.orgId) ?? []), p.id]);
    const all: { createdAt: Date; dto: MyInvitationDto }[] = [];
    for (const [orgId, ids] of byOrg) {
      const part = await withOrg(this.db, orgId, (tx) => this.read(tx, orgId, ids, user.email, true));
      all.push(...part);
    }
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.dto.id.localeCompare(a.dto.id));
    return slicePage(
      all.map((x) => x.dto),
      q,
    );
  }

  /** Any status, own email only; another email's id and an unknown id are the same 404. */
  async get(user: SessionUser, invitationId: string): Promise<MyInvitationDto> {
    const orgId = await this.orgOf(user, invitationId);
    const found = await withOrg(this.db, orgId, (tx) => this.read(tx, orgId, [invitationId], user.email, false));
    const [first] = found;
    if (!first) throw new NotFoundException(NOT_FOUND);
    return first.dto;
  }

  async accept(user: SessionUser, invitationId: string): Promise<AcceptInvitationResponse> {
    const orgId = await this.orgOf(user, invitationId);
    const response = await withOrg(this.db, orgId, async (tx) => {
      const row = await this.lockPending(tx, orgId, user, invitationId);
      await acceptInvitationInTx(tx, row, { id: user.userId });
      const [org] = await tx
        .select({ id: organization.id, name: organization.name, slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1);
      if (!org) throw new NotFoundException(NOT_FOUND);
      return { org };
    });
    this.logger.info({ requestId: requestContext.get()?.requestId, orgId, invitationId }, 'invitation accepted');
    return response;
  }

  async decline(user: SessionUser, invitationId: string): Promise<void> {
    const orgId = await this.orgOf(user, invitationId);
    await withOrg(this.db, orgId, async (tx) => {
      const row = await this.lockPending(tx, orgId, user, invitationId);
      await tx
        .update(invitations)
        .set({ status: 'declined' })
        .where(and(eq(invitations.orgId, orgId), eq(invitations.id, row.id)));
      await writeAuditEntry(tx, {
        orgId,
        actorUserId: user.userId,
        action: 'invitation.declined',
        targetType: 'invitation',
        targetId: row.id,
        payload: { email: row.email },
      });
    });
    this.logger.info({ requestId: requestContext.get()?.requestId, orgId, invitationId }, 'invitation declined');
  }

  /** The org of an invitation addressed to this verified email, else the one 404 (no hint which check failed). */
  private async orgOf(user: SessionUser, invitationId: string): Promise<string> {
    if (!user.emailVerified) throw new NotFoundException(NOT_FOUND);
    const orgId = await invitationOrgForEmail(this.db, invitationId, user.email);
    if (orgId === null) throw new NotFoundException(NOT_FOUND);
    return orgId;
  }

  /**
   * Under the per-user advisory lock, the invitation re-read `for update` (id, org and email match decided in SQL); an
   * effective status other than pending is a 409 carrying it, so a concurrent second call finds `accepted`.
   */
  private async lockPending(tx: Tx, orgId: string, user: SessionUser, invitationId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.userId}))`);
    const [row] = await tx
      .select({ invitation: invitations, status: effectiveStatus })
      .from(invitations)
      .where(
        and(
          eq(invitations.id, invitationId),
          eq(invitations.orgId, orgId),
          sql`${invitations.email} = lower(${user.email})`,
        ),
      )
      .for('update')
      .limit(1);
    if (!row) throw new NotFoundException(NOT_FOUND);
    if (row.status !== 'pending') throw new ConflictException(`Invitation is ${row.status}`);
    return row.invitation;
  }

  private async read(
    tx: Tx,
    orgId: string,
    ids: string[],
    email: string,
    pendingOnly: boolean,
  ): Promise<{ createdAt: Date; dto: MyInvitationDto }[]> {
    const rows = await tx
      .select({
        row: invitations,
        status: effectiveStatus,
        inviterName: userTable.name,
        inviterHandle: userTable.handle,
      })
      .from(invitations)
      .leftJoin(userTable, eq(userTable.id, invitations.invitedBy))
      .where(
        and(
          eq(invitations.orgId, orgId),
          inArray(invitations.id, ids),
          sql`${invitations.email} = lower(${email})`,
          pendingOnly ? sql`${effectiveStatus} = 'pending'` : undefined,
        ),
      )
      .orderBy(desc(invitations.createdAt), desc(invitations.id));
    if (rows.length === 0) return [];
    const [org] = await tx
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1);
    if (!org) return [];
    const roleMap = await roleRefs(tx, [...new Set(rows.map((r) => r.row.roleId))]);
    const projectList = await projectRefs(tx, orgId, [...new Set(rows.flatMap((r) => r.row.projectIds))]);
    const byProject = new Map(projectList.map((p) => [p.id, p]));
    return rows.flatMap((r) => {
      const role = roleMap.get(r.row.roleId);
      if (!role) return [];
      const inviter = r.inviterName === null ? null : { name: r.inviterName, handle: r.inviterHandle };
      const scope =
        r.row.scopeType === 'project'
          ? {
              type: 'project' as const,
              // a project deleted since is left out; the stored id order is kept
              projects: r.row.projectIds.flatMap((id) => {
                const p = byProject.get(id);
                return p ? [{ id: p.id, name: p.name }] : [];
              }),
            }
          : { type: 'org' as const };
      const dto: MyInvitationDto = {
        id: r.row.id,
        org,
        role: { key: role.key, name: role.name },
        scope,
        invitedBy: toInviterDto(inviter),
        expiresAt: r.row.expiresAt.toISOString(),
        status: InvitationStatus.parse(r.status),
      };
      return [{ createdAt: r.row.createdAt, dto }];
    });
  }
}
