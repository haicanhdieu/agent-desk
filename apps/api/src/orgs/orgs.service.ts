import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Logger } from 'pino';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { copyRoleTemplates, type Clock } from '@agentdesk/core';
import { organization, platformAuditLog, platformOrgStats, projects, user, withOrg, type Db } from '@agentdesk/db';
import {
  Id,
  OrgStatus,
  pageWindow,
  toPage,
  type CreateOrgRequest,
  type CreateOrgResponse,
  type OrgDto,
  type Page,
  type PageQuery,
  type PlatformOrgDetailDto,
  type PlatformOrgDto,
  type PlatformOrgSuspensionDto,
  type PlatformOrgListQuery,
  type PlatformProjectDto,
  type UpdateOrgRequest,
  type RoleDto,
} from '@agentdesk/contracts';
import { writeAuditEntry } from '../audit/audit-entry';
import { writePlatformAuditEntry } from '../audit/platform-audit-entry';
import { CLOCK } from '../common/clock';
import { LOGGER } from '../common/logger';
import { isUniqueViolation } from '../common/pg-errors';
import { requestContext } from '../common/request-context';
import { ConflictProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { loadAllRoles, toRoleDto } from './roles';

/** Escapes \, % and _ so the text matches literally in a LIKE pattern bound as a parameter with ESCAPE '\'. */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const ORG_COLUMNS = {
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  createdAt: organization.createdAt,
  status: organization.status,
  suspendedAt: organization.suspendedAt,
  // Qualified by hand: drizzle prints a bare "id" here, which would bind to member.id inside the subquery.
  memberCount: sql<number>`(select count(*)::int from "member" m where m.organization_id = "organization"."id")`,
};
type OrgRow = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  status: string;
  suspendedAt: Date | null;
  memberCount: number;
};

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * One withOrg(newId) tx: the organization row (id = uuid), the built-in roles copied from the templates and the
   * `org.created` audit entry. The slug is caught on the unique index, not read-then-insert, so two creates at the
   * same moment give one 201 and one 409.
   */
  async createOrg(actorUserId: string, req: CreateOrgRequest): Promise<CreateOrgResponse> {
    const orgId = randomUUID();
    try {
      await withOrg(this.db, orgId, async (tx) => {
        await tx.insert(organization).values({ id: orgId, name: req.name, slug: req.slug, createdAt: new Date() });
        await copyRoleTemplates(tx, orgId);
        await writeAuditEntry(tx, {
          orgId,
          actorUserId,
          actorKind: 'platform_admin',
          action: 'org.created',
          targetType: 'org',
          targetId: orgId,
          payload: { name: req.name, slug: req.slug },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictProblemException('Slug already in use', [
          { pointer: '/slug', detail: 'this slug is already taken' },
        ]);
      }
      throw err;
    }
    return { id: orgId, name: req.name, slug: req.slug };
  }

  /**
   * One withOrg(orgId) tx: read the row under a row lock (so concurrent PATCHes serialize and audit from/to stay true), keep only the fields that differ, write nothing when none do, otherwise update
   * and write one `org.updated` audit entry (from/to hold the changed fields only). A taken slug is caught on the
   * unique index. The caller's guard already matched `orgId` to the session's org.
   */
  async update(actorUserId: string, orgId: string, req: UpdateOrgRequest): Promise<OrgDto> {
    try {
      const result = await withOrg(this.db, orgId, async (tx): Promise<{ dto: OrgDto; changed: boolean }> => {
        const [current] = await tx
          .select({ id: organization.id, name: organization.name, slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, orgId))
          .limit(1)
          .for('update');
        if (!current) throw new NotFoundException('Organization not found');
        const from: { name?: string; slug?: string } = {};
        const to: { name?: string; slug?: string } = {};
        if (req.name !== undefined && req.name !== current.name) {
          from.name = current.name;
          to.name = req.name;
        }
        if (req.slug !== undefined && req.slug !== current.slug) {
          from.slug = current.slug;
          to.slug = req.slug;
        }
        if (Object.keys(to).length === 0) return { dto: current, changed: false };
        await tx.update(organization).set(to).where(eq(organization.id, orgId));
        await writeAuditEntry(tx, {
          orgId,
          actorUserId,
          actorKind: 'member',
          action: 'org.updated',
          targetType: 'org',
          targetId: orgId,
          payload: { from, to },
        });
        return { dto: { id: orgId, name: to.name ?? current.name, slug: to.slug ?? current.slug }, changed: true };
      });
      if (result.changed) {
        this.logger.info(
          { requestId: requestContext.get()?.requestId, orgId, actorUserId, action: 'org.updated' },
          'org updated',
        );
      }
      return result.dto;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictProblemException('Slug already in use', [
          { pointer: '/slug', detail: 'this slug is already taken' },
        ]);
      }
      throw err;
    }
  }

  /**
   * The directory, newest first (created_at desc, id). Platform-wide by design and read through plain `db.orm`: one
   * count and one page query with the same WHERE, then one `platform_org_stats` call (definer function, no tenant
   * rows) and one `user` lookup for the owners. Returns counts, timestamps and the owner's identity only.
   */
  async listOrgs(q: PlatformOrgListQuery): Promise<Page<PlatformOrgDto>> {
    const { limit, offset } = pageWindow(q);
    const orm = this.db.orm;
    const conds: SQL[] = [];
    if (q.q !== undefined && q.q !== '') {
      const pattern = likeContains(q.q.toLowerCase());
      conds.push(
        sql`(lower(${organization.name}) like ${pattern} escape '\\' or lower(${organization.slug}) like ${pattern} escape '\\')`,
      );
    }
    if (q.status !== undefined) conds.push(eq(organization.status, q.status));
    const where = conds.length > 0 ? and(...conds) : undefined;
    const [counted] = await orm
      .select({ total: sql<number>`count(*)::int` })
      .from(organization)
      .where(where);
    const rows = await orm
      .select(ORG_COLUMNS)
      .from(organization)
      .where(where)
      .orderBy(desc(organization.createdAt), asc(organization.id))
      .limit(limit)
      .offset(offset);
    return toPage(await this.toDtos(rows), counted?.total ?? 0, q);
  }

  /** One org with its suspension (the latest `org.suspended` row of that org while suspended, else null). 404 for an unknown or malformed id. */
  async getOrg(orgId: string): Promise<PlatformOrgDetailDto> {
    if (!Id.safeParse(orgId).success) throw new NotFoundException('Organization not found');
    const rows = await this.db.orm.select(ORG_COLUMNS).from(organization).where(eq(organization.id, orgId)).limit(1);
    if (rows.length === 0) throw new NotFoundException('Organization not found');
    const [dto] = await this.toDtos(rows);
    if (!dto) throw new NotFoundException('Organization not found');
    return { ...dto, suspension: dto.status === 'suspended' ? await this.suspensionOf(orgId, dto.suspendedAt) : null };
  }

  private async suspensionOf(orgId: string, suspendedAt: string | null): Promise<PlatformOrgSuspensionDto | null> {
    if (suspendedAt === null) return null;
    const [row] = await this.db.orm
      .select({
        payload: platformAuditLog.payload,
        actorUserId: platformAuditLog.actorUserId,
        name: user.name,
        handle: user.handle,
      })
      .from(platformAuditLog)
      .leftJoin(user, eq(user.id, platformAuditLog.actorUserId))
      .where(and(eq(platformAuditLog.targetOrgId, orgId), eq(platformAuditLog.action, 'org.suspended')))
      .orderBy(desc(platformAuditLog.createdAt), desc(platformAuditLog.id))
      .limit(1);
    if (!row) return null;
    const reason = (row.payload as Record<string, unknown> | null)?.['reason'];
    return {
      at: suspendedAt,
      reason: typeof reason === 'string' ? reason : '',
      by:
        row.actorUserId === null || row.name === null
          ? null
          : { userId: row.actorUserId, name: row.name, handle: row.handle },
    };
  }

  /**
   * Suspend or reactivate in one withOrg(orgId) tx: read the org row under a row lock (so concurrent changes
   * serialize and each audit from/to stays true), do nothing when it is already in `to`, else update `status` and
   * `suspended_at` (from the injected clock) and write the tenant row (no reason) and the platform row (with the
   * reason). The actor comes from the session. 404 for an unknown or malformed id.
   */
  async setStatus(actorUserId: string, orgId: string, to: OrgStatus, reason: string): Promise<PlatformOrgDetailDto> {
    if (!Id.safeParse(orgId).success) throw new NotFoundException('Organization not found');
    const changed = await withOrg(this.db, orgId, async (tx): Promise<boolean> => {
      const [current] = await tx
        .select({ status: organization.status })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1)
        .for('update');
      if (!current) throw new NotFoundException('Organization not found');
      if (current.status === to) return false;
      const from = OrgStatus.parse(current.status);
      await tx
        .update(organization)
        .set({ status: to, suspendedAt: to === 'suspended' ? this.clock.now() : null })
        .where(eq(organization.id, orgId));
      const action = to === 'suspended' ? 'org.suspended' : 'org.reactivated';
      await writeAuditEntry(tx, {
        orgId,
        actorUserId,
        actorKind: 'platform_admin',
        action,
        targetType: 'org',
        targetId: orgId,
        payload: { from, to },
      });
      await writePlatformAuditEntry(tx, {
        actorUserId,
        action,
        targetType: 'org',
        targetId: orgId,
        targetOrgId: orgId,
        payload: { from, to, reason },
      });
      return true;
    });
    if (changed) {
      this.logger.info(
        {
          requestId: requestContext.get()?.requestId,
          actorUserId,
          orgId,
          action: to === 'suspended' ? 'org.suspended' : 'org.reactivated',
        },
        'org status changed',
      );
    }
    return this.getOrg(orgId);
  }

  private async toDtos(rows: OrgRow[]): Promise<PlatformOrgDto[]> {
    if (rows.length === 0) return [];
    const stats = new Map(
      (
        await platformOrgStats(
          this.db,
          rows.map((r) => r.id),
        )
      ).map((s) => [s.orgId, s]),
    );
    const ownerIds = [...new Set([...stats.values()].flatMap((s) => (s.ownerUserId === null ? [] : [s.ownerUserId])))];
    const owners =
      ownerIds.length === 0
        ? []
        : await this.db.orm
            .select({ id: user.id, name: user.name, handle: user.handle, email: user.email })
            .from(user)
            .where(inArray(user.id, ownerIds));
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    return rows.map((r) => {
      const st = stats.get(r.id);
      const o = st?.ownerUserId == null ? undefined : ownerById.get(st.ownerUserId);
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        memberCount: r.memberCount,
        createdAt: r.createdAt.toISOString(),
        status: OrgStatus.parse(r.status),
        suspendedAt: r.suspendedAt === null ? null : r.suspendedAt.toISOString(),
        projectCount: st?.projectCount ?? 0,
        lastActivityAt: st?.lastActivityAt == null ? null : st.lastActivityAt.toISOString(),
        owner: o === undefined ? null : { userId: o.id, name: o.name, handle: o.handle, email: o.email },
      };
    });
  }

  async listProjects(orgId: string, q: PageQuery): Promise<Page<PlatformProjectDto>> {
    await this.requireOrg(orgId);
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      const [counted] = await tx.select({ total: sql<number>`count(*)::int` }).from(projects);
      const rows = await tx
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .orderBy(asc(projects.createdAt), asc(projects.id))
        .limit(limit)
        .offset(offset);
      return toPage(rows, counted?.total ?? 0, q);
    });
  }

  async listRoles(orgId: string): Promise<RoleDto[]> {
    await this.requireOrg(orgId);
    return withOrg(this.db, orgId, async (tx) => (await loadAllRoles(tx)).map(toRoleDto));
  }

  /** 404 unless the org exists. */
  async requireOrg(orgId: string): Promise<void> {
    const rows = await this.db.orm
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Organization not found');
  }
}
