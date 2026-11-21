import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { member, roleAssignments, roles, user, withOrg, type Db } from '@agentdesk/db';
import {
  can,
  holdsAnywhere,
  pageWindow,
  toPage,
  visibleProjects,
  type Access,
  type AssignmentDto,
  type MemberDto,
  type Page,
  type PageQuery,
  type PlatformMemberDto,
} from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL } from '../access/authorize';
import { DB } from '../db/db.module';
import { OrgsService } from '../orgs/orgs.service';
import { toAssignmentDto } from '../assignments/assignments.service';

/** Which assignments of a member the caller may see: org-scope ones too, and project-scope ones on all or only some projects. */
interface Visible {
  orgScope: boolean;
  projects: 'all' | string[];
}

interface MemberRow {
  userId: string;
  handle: string | null;
  name: string;
  email: string;
  assignments: AssignmentDto[];
}

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OrgsService) private readonly orgs: OrgsService,
  ) {}

  /**
   * Every member of the org (user joined with member), handle ascending, never with an email. The caller must hold
   * `member:read` at org scope or `assignment:create` somewhere, else 403 (the guard checks too; this is the exact
   * check). Assignments: all of them for an org-scope `member:read` holder; for anyone else only the project-scope
   * ones on projects where the caller holds `assignment:read`, plus the org-scope ones when that grant is org-scope.
   */
  async list(access: Access, orgId: string, q: PageQuery): Promise<Page<MemberDto>> {
    if (!holdsAnywhere(access, 'member:read') && !holdsAnywhere(access, 'assignment:create')) {
      throw new ForbiddenException(FORBIDDEN_DETAIL);
    }
    let visible: Visible = { orgScope: true, projects: 'all' };
    if (!can(access, 'member:read')) {
      const readable = visibleProjects(access, 'assignment:read');
      // 'all' means an org-scope assignment:read grant: the assignment list shows org-scope rows to that caller too
      visible = { orgScope: readable === 'all', projects: readable };
    }
    const page = await this.load(orgId, q, visible);
    // fields are picked one by one so the email read for the shared query can never reach a tenant response
    return {
      ...page,
      items: page.items.map((m) => ({
        userId: m.userId,
        handle: m.handle,
        name: m.name,
        assignments: m.assignments,
      })),
    };
  }

  /** The same members with their email and every assignment. 404 when the org does not exist. */
  async listForPlatform(orgId: string, q: PageQuery): Promise<Page<PlatformMemberDto>> {
    await this.orgs.requireOrg(orgId);
    return this.load(orgId, q, { orgScope: true, projects: 'all' });
  }

  private async load(orgId: string, q: PageQuery, visible: Visible): Promise<Page<MemberRow>> {
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      const inOrg = eq(member.organizationId, orgId);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(member)
        .where(inOrg);
      const people = await tx
        .select({ userId: user.id, handle: user.handle, name: user.name, email: user.email })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(inOrg)
        .orderBy(asc(user.handle), asc(user.id))
        .limit(limit)
        .offset(offset);

      const byUser = new Map<string, AssignmentDto[]>();
      const nothingVisible = !visible.orgScope && visible.projects !== 'all' && visible.projects.length === 0;
      if (people.length > 0 && !nothingVisible) {
        const filters: SQL[] = [
          eq(roleAssignments.orgId, orgId),
          inArray(
            roleAssignments.userId,
            people.map((p) => p.userId),
          ),
        ];
        if (!visible.orgScope) filters.push(eq(roleAssignments.scopeType, 'project'));
        if (visible.projects !== 'all') filters.push(inArray(roleAssignments.projectId, visible.projects));
        const rows = await tx
          .select({
            id: roleAssignments.id,
            userId: roleAssignments.userId,
            roleId: roleAssignments.roleId,
            roleKey: roles.key,
            roleName: roles.name,
            scopeType: roleAssignments.scopeType,
            projectId: roleAssignments.projectId,
            grantedBy: roleAssignments.grantedBy,
            grantedAt: roleAssignments.grantedAt,
          })
          .from(roleAssignments)
          .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
          .where(and(...filters))
          .orderBy(asc(roleAssignments.grantedAt), asc(roleAssignments.id));
        for (const r of rows) {
          const list = byUser.get(r.userId) ?? [];
          list.push(toAssignmentDto(r));
          byUser.set(r.userId, list);
        }
      }
      return toPage(
        people.map((p) => ({ ...p, assignments: byUser.get(p.userId) ?? [] })),
        counted?.total ?? 0,
        q,
      );
    });
  }
}
