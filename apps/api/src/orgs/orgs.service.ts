import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { copyRoleTemplates } from '@agentdesk/core';
import { organization, projects, withOrg, type Db } from '@agentdesk/db';
import {
  pageWindow,
  toPage,
  type CreateOrgRequest,
  type CreateOrgResponse,
  type Page,
  type PageQuery,
  type PlatformOrgDto,
  type PlatformProjectDto,
  type RoleDto,
} from '@agentdesk/contracts';
import { writeAuditEntry } from '../audit/audit-entry';
import { isUniqueViolation } from '../common/pg-errors';
import { ConflictProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { loadAllRoles, toRoleDto } from './roles';

@Injectable()
export class OrgsService {
  constructor(@Inject(DB) private readonly db: Db) {}

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
