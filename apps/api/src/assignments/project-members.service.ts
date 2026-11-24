import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Logger } from 'pino';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { member, projects, roleAssignments, roles, user, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  pageWindow,
  toPage,
  type Access,
  type AddProjectMemberRequest,
  type Page,
  type PageQuery,
  type ProjectMemberDto,
} from '@agentdesk/contracts';
import { FORBIDDEN_DETAIL } from '../access/authorize';
import { checkTenantAssign } from '../access/grant-rules';
import { writeAuditEntry } from '../audit/audit-entry';
import { LOGGER } from '../common/logger';
import { requestContext } from '../common/request-context';
import {
  ConflictProblemException,
  NotFoundProblemException,
  UnprocessableProblemException,
} from '../common/zod-validation';
import { DB } from '../db/db.module';
import { loadRole } from '../orgs/roles';
import type { AssignmentRow } from './assignments.service';

/** The 409 problem title for adding a person who already has a role on the project. */
export const ALREADY_ON_PROJECT = 'Already has a role on this project';
/** The 404 problem title for a person with no project-scope role on the project (change role and remove). */
export const NOT_ON_PROJECT = 'Member is no longer on this project';

const assignmentColumns = {
  id: roleAssignments.id,
  userId: roleAssignments.userId,
  roleId: roleAssignments.roleId,
  roleKey: roles.key,
  roleName: roles.name,
  scopeType: roleAssignments.scopeType,
  projectId: roleAssignments.projectId,
  grantedBy: roleAssignments.grantedBy,
  grantedAt: roleAssignments.grantedAt,
};

function toProjectRole(row: AssignmentRow): ProjectMemberDto['projectRoles'][number] {
  return { assignmentId: row.id, role: { id: row.roleId, key: row.roleKey, name: row.roleName } };
}

function toOrgRole(row: AssignmentRow): ProjectMemberDto['orgRoles'][number] {
  return { role: { id: row.roleId, key: row.roleKey, name: row.roleName } };
}

/** The person's org-scope rows (roles on the whole organization), oldest first. They apply to every project of the org. */
async function orgRowsOf(tx: Tx, orgId: string, userIds: string[]): Promise<AssignmentRow[]> {
  if (userIds.length === 0) return [];
  return tx
    .select(assignmentColumns)
    .from(roleAssignments)
    .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
    .where(
      and(
        eq(roleAssignments.orgId, orgId),
        eq(roleAssignments.scopeType, 'org'),
        inArray(roleAssignments.userId, userIds),
      ),
    )
    .orderBy(asc(roleAssignments.grantedAt), asc(roleAssignments.id));
}

/** One member row from the person's project-scope and org-scope rows; `source` is 'org' when only the org ones exist. */
function toMemberDto(
  person: { userId: string; name: string; handle: string | null },
  projectRows: AssignmentRow[],
  orgRows: AssignmentRow[],
): ProjectMemberDto {
  return {
    ...person,
    source: projectRows.length > 0 ? 'project' : 'org',
    projectRoles: projectRows.map(toProjectRole),
    orgRoles: orgRows.map(toOrgRole),
  };
}

/** The person's project-scope rows on `projectId`, oldest first. Add `lock` to take them `FOR UPDATE`. */
async function projectRowsOf(
  tx: Tx,
  orgId: string,
  projectId: string,
  userIds: string[],
  lock: boolean,
): Promise<AssignmentRow[]> {
  if (userIds.length === 0) return [];
  const query = tx
    .select(assignmentColumns)
    .from(roleAssignments)
    .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
    .where(
      and(
        eq(roleAssignments.orgId, orgId),
        eq(roleAssignments.scopeType, 'project'),
        eq(roleAssignments.projectId, projectId),
        inArray(roleAssignments.userId, userIds),
      ),
    )
    .orderBy(asc(roleAssignments.grantedAt), asc(roleAssignments.id));
  return lock ? query.for('update', { of: roleAssignments }) : query;
}

function groupByUser(rows: AssignmentRow[]): Map<string, AssignmentRow[]> {
  const byUser = new Map<string, AssignmentRow[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  return byUser;
}

@Injectable()
export class ProjectMembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Everyone with access to `projectId`, name then id: the people holding a project-scope role on it and the people
   * holding an org-scope role (which applies to every project of the org), each with both kinds of role (access adds up,
   * ADR-0036). Org-scope roles are listed read-only (`source` 'org' when there is no project role). The guard has
   * already decided 403 (`assignment:read`) and 404 (project out of scope or gone); the query filters by org and project.
   */
  async list(orgId: string, projectId: string, q: PageQuery): Promise<Page<ProjectMemberDto>> {
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      const onProject = and(
        eq(roleAssignments.orgId, orgId),
        or(
          and(eq(roleAssignments.scopeType, 'project'), eq(roleAssignments.projectId, projectId)),
          eq(roleAssignments.scopeType, 'org'),
        ),
      );
      const [counted] = await tx
        .select({ total: sql<number>`count(distinct ${roleAssignments.userId})::int` })
        .from(roleAssignments)
        .where(onProject);
      const people = await tx
        .select({ userId: user.id, name: user.name, handle: user.handle })
        .from(roleAssignments)
        .innerJoin(user, eq(user.id, roleAssignments.userId))
        .where(onProject)
        .groupBy(user.id, user.name, user.handle)
        .orderBy(asc(user.name), asc(user.id))
        .limit(limit)
        .offset(offset);
      const ids = people.map((p) => p.userId);
      const projectRows = groupByUser(await projectRowsOf(tx, orgId, projectId, ids, false));
      const orgRows = groupByUser(await orgRowsOf(tx, orgId, ids));
      const items = people.map((p) => toMemberDto(p, projectRows.get(p.userId) ?? [], orgRows.get(p.userId) ?? []));
      return toPage(items, counted?.total ?? 0, q);
    });
  }

  /**
   * Gives an org member a project-scope role. Order: role in the org and project-assignable (422 /roleId), the person
   * is an org member (422 /userId, the same for unknown users), `checkTenantAssign` create (403), then a person who
   * already holds any role on the project is 409 (nothing written). The member row and then the person's rows on the
   * project are locked, so two writes for one person serialize even when they hold no row yet.
   */
  async add(access: Access, orgId: string, projectId: string, req: AddProjectMemberRequest): Promise<ProjectMemberDto> {
    const dto = await withOrg(this.db, orgId, async (tx) => {
      const role = await loadRole(tx, req.roleId);
      if (!role || !role.assignableScopes.includes('project')) {
        throw new UnprocessableProblemException('Role not allowed here', [
          {
            pointer: '/roleId',
            detail: 'this role does not exist in the organization or cannot be given at this scope',
          },
        ]);
      }
      const { inOrg, rows } = await this.lockPerson(tx, orgId, projectId, req.userId);
      if (!inOrg) {
        throw new UnprocessableProblemException('User not found', [
          { pointer: '/userId', detail: 'this person is not a member of the organization' },
        ]);
      }
      if (!checkTenantAssign(access, 'assignment:create', role, { type: 'project', projectId }).ok) {
        throw new ForbiddenException(FORBIDDEN_DETAIL);
      }
      if (rows.length > 0) throw new ConflictProblemException(ALREADY_ON_PROJECT, []);
      // the project can be deleted between the guard and this transaction; answer 404, not a foreign-key 500
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
        .limit(1)
        .for('share');
      if (!project) throw new NotFoundException('Project not found');
      await tx.insert(roleAssignments).values({
        orgId,
        userId: req.userId,
        roleId: role.id,
        scopeType: 'project',
        projectId,
        grantedBy: access.userId,
      });
      await writeAuditEntry(tx, {
        orgId,
        actorUserId: access.userId,
        actorKind: 'member',
        action: 'assignment.granted',
        targetType: 'user',
        targetId: req.userId,
        payload: { to: { roleId: role.id, roleKey: role.key, scope: { type: 'project', projectId } } },
        projectIds: [projectId],
      });
      return this.loadOne(tx, orgId, projectId, req.userId);
    });
    this.logger.info(
      {
        requestId: requestContext.get()?.requestId,
        orgId,
        projectId,
        actorUserId: access.userId,
        targetUserId: req.userId,
        action: 'assignment.granted',
      },
      'project member added',
    );
    return dto;
  }

  /**
   * Replaces the person's project-scope roles on the project with one row. Order: lock the person (member row, the
   * project row `FOR SHARE`, then their rows on the project; a project that is gone is 404); no row on the project is 404, an unusable role is 422 /roleId, then
   * `checkTenantAssign` create on the new role and delete on each replaced role (403). The same single role again is
   * 200 with nothing written. Concurrent writes for one person serialize on the locks; the last one wins.
   */
  async setRole(
    access: Access,
    orgId: string,
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<ProjectMemberDto> {
    const { dto, changed } = await withOrg(this.db, orgId, async (tx) => {
      const { rows } = await this.lockPerson(tx, orgId, projectId, userId, true);
      if (rows.length === 0) throw new NotFoundProblemException(NOT_ON_PROJECT, []);
      const role = await loadRole(tx, roleId);
      if (!role || !role.assignableScopes.includes('project')) {
        throw new UnprocessableProblemException('Role not allowed here', [
          {
            pointer: '/roleId',
            detail: 'this role does not exist in the organization or cannot be given at this scope',
          },
        ]);
      }
      const scope = { type: 'project', projectId } as const;
      if (!checkTenantAssign(access, 'assignment:create', role, scope).ok) {
        throw new ForbiddenException(FORBIDDEN_DETAIL);
      }
      await this.checkCanDelete(tx, access, rows, scope);
      const unchanged = rows.length === 1 && rows[0]?.roleId === role.id;
      if (!unchanged) {
        await tx.delete(roleAssignments).where(
          and(
            eq(roleAssignments.orgId, orgId),
            inArray(
              roleAssignments.id,
              rows.map((r) => r.id),
            ),
          ),
        );
        await tx.insert(roleAssignments).values({
          orgId,
          userId,
          roleId: role.id,
          scopeType: 'project',
          projectId,
          grantedBy: access.userId,
        });
        await writeAuditEntry(tx, {
          orgId,
          actorUserId: access.userId,
          actorKind: 'member',
          action: 'project_member.role_changed',
          targetType: 'user',
          targetId: userId,
          payload: { projectId, from: rows.map((r) => r.roleKey), to: role.key },
          projectIds: [projectId],
        });
      }
      return { dto: await this.loadOne(tx, orgId, projectId, userId), changed: !unchanged };
    });
    // the log follows the audit trail: nothing is logged when nothing was written
    if (changed) {
      this.logChange(orgId, projectId, access.userId, userId, 'project_member.role_changed', 'project role changed');
    }
    return dto;
  }

  /**
   * Removes the person's project-scope roles on the project (never org-scope ones). Yourself is 403 before any lookup;
   * no row on the project is 404; `checkTenantAssign` delete on each row's role (403).
   */
  async remove(access: Access, orgId: string, projectId: string, userId: string): Promise<void> {
    if (userId === access.userId) throw new ForbiddenException(FORBIDDEN_DETAIL);
    await withOrg(this.db, orgId, async (tx) => {
      const { rows } = await this.lockPerson(tx, orgId, projectId, userId);
      if (rows.length === 0) throw new NotFoundProblemException(NOT_ON_PROJECT, []);
      await this.checkCanDelete(tx, access, rows, { type: 'project', projectId });
      await tx.delete(roleAssignments).where(
        and(
          eq(roleAssignments.orgId, orgId),
          inArray(
            roleAssignments.id,
            rows.map((r) => r.id),
          ),
        ),
      );
      await writeAuditEntry(tx, {
        orgId,
        actorUserId: access.userId,
        actorKind: 'member',
        action: 'project_member.removed',
        targetType: 'user',
        targetId: userId,
        payload: { projectId, from: rows.map((r) => r.roleKey) },
        projectIds: [projectId],
      });
    });
    this.logChange(orgId, projectId, access.userId, userId, 'project_member.removed', 'project member removed');
  }

  /** 403 unless the actor may delete the assignment of every distinct role in `rows` at `scope`. */
  private async checkCanDelete(
    tx: Tx,
    access: Access,
    rows: AssignmentRow[],
    scope: { type: 'project'; projectId: string },
  ): Promise<void> {
    for (const roleId of new Set(rows.map((r) => r.roleId))) {
      const role = await loadRole(tx, roleId);
      if (!role || !checkTenantAssign(access, 'assignment:delete', role, scope).ok) {
        throw new ForbiddenException(FORBIDDEN_DETAIL);
      }
    }
  }

  private logChange(
    orgId: string,
    projectId: string,
    actorUserId: string,
    targetUserId: string,
    action: string,
    message: string,
  ): void {
    this.logger.info(
      { requestId: requestContext.get()?.requestId, orgId, projectId, actorUserId, targetUserId, action },
      message,
    );
  }

  /**
   * Locks the member row, then the person's project-scope rows on P (both FOR UPDATE); no member row = not in the org.
   * With `lockProject` the project row is locked `FOR SHARE` between the two (404 when it is gone): a write that
   * deletes and re-inserts the person's rows takes the project row (the insert's foreign key does) while holding them,
   * and a project delete locks the project row first and then cascades over those rows, so the project row must come
   * first or the two deadlock (40P01, a 500). The delete never locks member rows, so member row first stays safe.
   */
  private async lockPerson(
    tx: Tx,
    orgId: string,
    projectId: string,
    userId: string,
    lockProject = false,
  ): Promise<{ inOrg: boolean; rows: AssignmentRow[] }> {
    const [target] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1)
      .for('update');
    if (!target) return { inOrg: false, rows: [] };
    if (lockProject) {
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
        .limit(1)
        .for('share');
      if (!project) throw new NotFoundException('Project not found');
    }
    return { inOrg: true, rows: await projectRowsOf(tx, orgId, projectId, [userId], true) };
  }

  private async loadOne(tx: Tx, orgId: string, projectId: string, userId: string): Promise<ProjectMemberDto> {
    const [person] = await tx
      .select({ userId: user.id, name: user.name, handle: user.handle })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!person) throw new ConflictProblemException('Member changed, try again', []);
    const rows = await projectRowsOf(tx, orgId, projectId, [userId], false);
    return toMemberDto(person, rows, await orgRowsOf(tx, orgId, [userId]));
  }
}
