import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Logger } from 'pino';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { member, projects, roleAssignments, roles, user, withOrg, type Db } from '@agentdesk/db';
import {
  can,
  holdsAnywhere,
  inScope,
  pageWindow,
  toPage,
  visibleProjects,
  type Access,
  type AssignmentDto,
  type MemberDto,
  type MembersListQuery,
  type Page,
  type PageQuery,
  type PlatformMemberDto,
} from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL } from '../access/authorize';
import { checkTenantAssign } from '../access/grant-rules';
import { writeAuditEntry } from '../audit/audit-entry';
import { LOGGER } from '../common/logger';
import { requestContext } from '../common/request-context';
import { ConflictProblemException, UnprocessableProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { loadRole } from '../orgs/roles';
import { lockOrgOwnerRows } from './owner-lock';
import { OrgsService } from '../orgs/orgs.service';
import { toAssignmentDto } from '../assignments/assignments.service';

/** Which assignments of a member the caller may see: org-scope ones too, and project-scope ones on all or only some projects. */
interface Visible {
  orgScope: boolean;
  projects: 'all' | string[];
}

/** Escapes `\`, `%` and `_` so user text matches literally inside an `ILIKE ... ESCAPE '\'` pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The 404 problem title for a user who is not a member of the org. */
export const NOT_A_MEMBER = 'Member is no longer in the organization';

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
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Every member of the org (user joined with member), handle ascending, never with an email. The caller must hold
   * `member:read` at org scope or `assignment:create` somewhere, else 403 (the guard checks too; this is the exact
   * check). Assignments: all of them for an org-scope `member:read` holder; for anyone else only the project-scope
   * ones on projects where the caller holds `assignment:read`, plus the org-scope ones when that grant is org-scope.
   */
  async list(access: Access, orgId: string, q: MembersListQuery): Promise<Page<MemberDto>> {
    if (!holdsAnywhere(access, 'member:read') && !holdsAnywhere(access, 'assignment:create')) {
      throw new ForbiddenException(FORBIDDEN_DETAIL);
    }
    const visible = this.visibleFor(access);
    const { q: search, excludeProject, ...paging } = q;
    if (excludeProject !== undefined) await this.requireProjectReader(access, orgId, excludeProject);
    const page = await this.load(orgId, paging, visible, undefined, { q: search, excludeProject });
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

  /** The project exists in the org (404), is in the caller's scope (404), and the caller holds `assignment:read` on it (403). */
  private async requireProjectReader(access: Access, orgId: string, projectId: string): Promise<void> {
    const found = await withOrg(this.db, orgId, async (tx) => {
      const [row] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
        .limit(1);
      return row !== undefined;
    });
    if (!found || !inScope(access, projectId)) throw new NotFoundException('Project not found');
    if (!can(access, 'assignment:read', { projectId })) throw new ForbiddenException(FORBIDDEN_DETAIL);
  }

  private visibleFor(access: Access): Visible {
    if (can(access, 'member:read')) return { orgScope: true, projects: 'all' };
    const readable = visibleProjects(access, 'assignment:read');
    // 'all' means an org-scope assignment:read grant: the assignment list shows org-scope rows to that caller too
    return { orgScope: readable === 'all', projects: readable };
  }

  /**
   * Sets the member's org-scope role to `roleId` (null removes the org-scope assignments; project ones stay), in one
   * `withOrg` transaction with the audit entry. 403 for the caller's own user id (whatever their role) or without
   * `member:update`, before any lookup; 404 for a non-member;
   * 422 `/roleId` for a role that is missing or not org-assignable; `checkTenantAssign` on each removed and the new
   * role; 409 when the org would be left without an owner (owner rows are locked in id order first, so two
   * concurrent demotions cannot both pass). The same role again is a no-op without an audit row, but only after these checks: an org admin giving `owner` to an owner is 403.
   */
  async updateRole(access: Access, orgId: string, userId: string, roleId: string | null): Promise<MemberDto> {
    // nobody changes their own org role, whatever it is; `access.userId` comes from the session, never the request
    if (userId === access.userId || !can(access, 'member:update')) throw new ForbiddenException(FORBIDDEN_DETAIL);
    const changed = await withOrg(this.db, orgId, async (tx) => {
      // owner rows first (id order), then the member row: a change queued behind a removal of the same member finds it
      // gone (404) instead of re-granting, with or without owners
      const owners = await lockOrgOwnerRows(tx, orgId);
      const [target] = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
        .limit(1)
        .for('update');
      if (!target) throw new NotFoundException(NOT_A_MEMBER);
      const next = roleId === null ? null : await loadRole(tx, roleId);
      if (roleId !== null && (!next || !next.assignableScopes.includes('org'))) {
        throw new UnprocessableProblemException('Role not allowed here', [
          {
            pointer: '/roleId',
            detail: 'this role does not exist in the organization or cannot be given at this scope',
          },
        ]);
      }
      const current = await tx
        .select({ id: roleAssignments.id, roleId: roleAssignments.roleId, roleKey: roles.key })
        .from(roleAssignments)
        .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
        .where(
          and(
            eq(roleAssignments.orgId, orgId),
            eq(roleAssignments.userId, userId),
            eq(roleAssignments.scopeType, 'org'),
          ),
        )
        .orderBy(asc(roleAssignments.id));
      const removed = current.filter((r) => r.roleId !== roleId);
      const keeps = current.some((r) => r.roleId === roleId);
      for (const r of removed) {
        const role = await loadRole(tx, r.roleId);
        if (!role || !checkTenantAssign(access, 'assignment:delete', role, { type: 'org' }).ok) {
          throw new ForbiddenException(FORBIDDEN_DETAIL);
        }
      }
      // the create check runs on the requested role even when the member already holds it: an admin never gives owner
      if (next && !checkTenantAssign(access, 'assignment:create', next, { type: 'org' }).ok) {
        throw new ForbiddenException(FORBIDDEN_DETAIL);
      }
      if (removed.some((r) => r.roleKey === 'owner') && !owners.some((o) => o.userId !== userId)) {
        throw new ConflictProblemException('The organization needs at least one owner', []);
      }
      // nothing to change: 200 without an audit row, after every check above
      if (removed.length === 0 && (roleId === null || keeps)) return false;
      if (removed.length > 0) {
        await tx.delete(roleAssignments).where(
          and(
            eq(roleAssignments.orgId, orgId),
            inArray(
              roleAssignments.id,
              removed.map((r) => r.id),
            ),
          ),
        );
      }
      if (next && !keeps) {
        await tx.insert(roleAssignments).values({
          orgId,
          userId,
          roleId: next.id,
          scopeType: 'org',
          projectId: null,
          grantedBy: access.userId,
        });
      }
      await writeAuditEntry(tx, {
        orgId,
        actorUserId: access.userId,
        actorKind: 'member',
        action: 'member.role_changed',
        targetType: 'user',
        targetId: userId,
        payload: { from: current.map((r) => r.roleKey), to: next ? next.key : null },
      });
      return true;
    });
    if (changed) {
      this.logger.info(
        {
          requestId: requestContext.get()?.requestId,
          orgId,
          actorUserId: access.userId,
          targetUserId: userId,
          action: 'member.role_changed',
        },
        'member role changed',
      );
    }
    const page = await this.load(orgId, { page: 1, pageSize: 1 }, this.visibleFor(access), userId);
    const dto = page.items[0];
    if (!dto) throw new NotFoundException(NOT_A_MEMBER);
    return { userId: dto.userId, handle: dto.handle, name: dto.name, assignments: dto.assignments };
  }

  /**
   * Removes the member from the org: every assignment of the user in the org (org and project scope) and the
   * `member` row, in one `withOrg` transaction with the audit entry. 403 for self-removal or without
   * `member:delete`, before any lookup; 404 for a non-member; `checkTenantAssign` `assignment:delete` on each
   * assignment (403); 409 when an org-scope owner goes and no other owner would remain (owner rows locked first).
   * The user's runs are not touched.
   */
  async remove(access: Access, orgId: string, userId: string): Promise<void> {
    if (userId === access.userId || !can(access, 'member:delete')) throw new ForbiddenException(FORBIDDEN_DETAIL);
    await withOrg(this.db, orgId, async (tx) => {
      // owner rows first (id order), then the member row: a second removal queued behind this one finds the member
      // gone (404), not a second audit row, with or without owners
      const owners = await lockOrgOwnerRows(tx, orgId);
      const [target] = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
        .limit(1)
        .for('update');
      if (!target) throw new NotFoundException(NOT_A_MEMBER);
      const current = await tx
        .select({
          id: roleAssignments.id,
          roleId: roleAssignments.roleId,
          roleKey: roles.key,
          scopeType: roleAssignments.scopeType,
          projectId: roleAssignments.projectId,
        })
        .from(roleAssignments)
        .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
        .where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.userId, userId)))
        .orderBy(asc(roleAssignments.id));
      for (const r of current) {
        const role = await loadRole(tx, r.roleId);
        const scope =
          r.scopeType === 'org' || r.projectId === null
            ? ({ type: 'org' } as const)
            : ({ type: 'project', projectId: r.projectId } as const);
        if (!role || !checkTenantAssign(access, 'assignment:delete', role, scope).ok) {
          throw new ForbiddenException(FORBIDDEN_DETAIL);
        }
      }
      const losesOwner = current.some((r) => r.scopeType === 'org' && r.roleKey === 'owner');
      if (losesOwner && !owners.some((o) => o.userId !== userId)) {
        throw new ConflictProblemException('The organization needs at least one owner', []);
      }
      await tx.delete(roleAssignments).where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.userId, userId)));
      await tx.delete(member).where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
      await writeAuditEntry(tx, {
        orgId,
        actorUserId: access.userId,
        actorKind: 'member',
        action: 'member.removed',
        targetType: 'user',
        targetId: userId,
        payload: {
          from: current.map((r) => ({
            roleKey: r.roleKey,
            scope: r.scopeType === 'org' ? 'org' : 'project',
            projectId: r.projectId,
          })),
        },
      });
    });
    this.logger.info(
      {
        requestId: requestContext.get()?.requestId,
        orgId,
        actorUserId: access.userId,
        targetUserId: userId,
        action: 'member.removed',
      },
      'member removed',
    );
  }

  /** The same members with their email and every assignment. 404 when the org does not exist. */
  async listForPlatform(orgId: string, q: PageQuery): Promise<Page<PlatformMemberDto>> {
    await this.orgs.requireOrg(orgId);
    return this.load(orgId, q, { orgScope: true, projects: 'all' });
  }

  private async load(
    orgId: string,
    q: PageQuery,
    visible: Visible,
    only?: string,
    filter?: { q?: string; excludeProject?: string },
  ): Promise<Page<MemberRow>> {
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      const conditions: (SQL | undefined)[] = [eq(member.organizationId, orgId)];
      if (only !== undefined) conditions.push(eq(member.userId, only));
      if (filter?.q !== undefined) {
        // bound parameter, wildcards escaped: the text only ever matches literally
        const pattern = `%${escapeLike(filter.q)}%`;
        conditions.push(
          or(sql`${user.name} ILIKE ${pattern} ESCAPE '\\'`, sql`${user.handle} ILIKE ${pattern} ESCAPE '\\'`),
        );
      }
      if (filter?.excludeProject !== undefined) {
        conditions.push(
          sql`NOT EXISTS (SELECT 1 FROM ${roleAssignments} WHERE ${roleAssignments.orgId} = ${orgId} AND ${roleAssignments.userId} = ${member.userId} AND (${roleAssignments.scopeType} = 'org' OR (${roleAssignments.scopeType} = 'project' AND ${roleAssignments.projectId} = ${filter.excludeProject})))`,
        );
      }
      const inOrg = and(...conditions);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
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
