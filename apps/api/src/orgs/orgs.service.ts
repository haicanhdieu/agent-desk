import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Logger } from 'pino';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { copyRoleTemplates } from '@agentdesk/core';
import { organization, projects, withOrg, type Db } from '@agentdesk/db';
import {
  pageWindow,
  toPage,
  type CreateOrgRequest,
  type CreateOrgResponse,
  type OrgDto,
  type Page,
  type PageQuery,
  type PlatformOrgDto,
  type PlatformProjectDto,
  type UpdateOrgRequest,
  type RoleDto,
} from '@agentdesk/contracts';
import { writeAuditEntry } from '../audit/audit-entry';
import { LOGGER } from '../common/logger';
import { isUniqueViolation } from '../common/pg-errors';
import { requestContext } from '../common/request-context';
import { ConflictProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { loadAllRoles, toRoleDto } from './roles';

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
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

  /** Every org, newest first. Platform-wide by design: the platform admin sees ids, names, slugs and member counts only. */
  async listOrgs(q: PageQuery): Promise<Page<PlatformOrgDto>> {
    const { limit, offset } = pageWindow(q);
    const orm = this.db.orm;
    const [counted] = await orm.select({ total: sql<number>`count(*)::int` }).from(organization);
    const rows = await orm
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: organization.createdAt,
        // Qualified by hand: drizzle prints a bare "id" here, which would bind to member.id inside the subquery.
        memberCount: sql<number>`(select count(*)::int from "member" m where m.organization_id = "organization"."id")`,
      })
      .from(organization)
      .orderBy(desc(organization.createdAt), asc(organization.id))
      .limit(limit)
      .offset(offset);
    return toPage(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        memberCount: r.memberCount,
        createdAt: r.createdAt.toISOString(),
        // Placeholders until the directory query lands in the next task.
        status: 'active' as const,
        suspendedAt: null,
        projectCount: 0,
        lastActivityAt: null,
        owner: null,
      })),
      counted?.total ?? 0,
      q,
    );
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
