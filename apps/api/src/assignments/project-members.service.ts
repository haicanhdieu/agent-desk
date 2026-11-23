import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Logger } from 'pino';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
import { ConflictProblemException, UnprocessableProblemException } from '../common/zod-validation';
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

@Injectable()
export class ProjectMembersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * The people holding a project-scope role on `projectId`, name then id, each with their roles on it. The guard has
   * already decided 403 (`assignment:read`) and 404 (project out of scope or gone); the query filters by org and project.
   */
  async list(orgId: string, projectId: string, q: PageQuery): Promise<Page<ProjectMemberDto>> {
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      const onProject = and(
        eq(roleAssignments.orgId, orgId),
        eq(roleAssignments.scopeType, 'project'),
        eq(roleAssignments.projectId, projectId),
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
      const rows = await projectRowsOf(
        tx,
        orgId,
        projectId,
        people.map((p) => p.userId),
        false,
      );
      const byUser = new Map<string, ProjectMemberDto['projectRoles']>();
      for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), toProjectRole(r)]);
      const items = people.map((p) => ({ ...p, projectRoles: byUser.get(p.userId) ?? [] }));
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

  /** Locks the member row, then the person's project-scope rows on P (both FOR UPDATE); no member row = not in the org. */
  private async lockPerson(
    tx: Tx,
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<{ inOrg: boolean; rows: AssignmentRow[] }> {
    const [target] = await tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1)
      .for('update');
    if (!target) return { inOrg: false, rows: [] };
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
    return { ...person, projectRoles: rows.map(toProjectRole) };
  }
}
