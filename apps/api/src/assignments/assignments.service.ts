import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { member, projects, roleAssignments, roles, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  can,
  holdsAnywhere,
  inScope,
  pageWindow,
  toPage,
  visibleProjects,
  type Access,
  type AccessDto,
  type AssignmentDto,
  type AssignmentListQuery,
  type CreateAssignmentRequest,
  type Page,
  type Scope,
} from '@agentdesk/contracts';
import { actorUserId, type Actor } from '../access/actor';
import { FORBIDDEN_DETAIL } from '../access/authorize';
import { checkTenantAssign } from '../access/grant-rules';
import { writeAuditEntry } from '../audit/audit-entry';
import { ConflictProblemException, UnprocessableProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { OrgsService } from '../orgs/orgs.service';
import { loadRole } from '../orgs/roles';

/** A `role_assignments` row joined with its role's key and name. */
export interface AssignmentRow {
  id: string;
  userId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  scopeType: string;
  projectId: string | null;
  grantedBy: string | null;
  grantedAt: Date;
}

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

export function toAssignmentDto(row: AssignmentRow): AssignmentDto {
  let scope: Scope;
  if (row.scopeType === 'project') {
    // the table CHECK ties a project scope to a project id; a row that breaks it is never shown as an org grant
    if (row.projectId === null) throw new Error('project-scope assignment without a project');
    scope = { type: 'project', projectId: row.projectId };
  } else {
    scope = { type: 'org' };
  }
  return {
    id: row.id,
    userId: row.userId,
    role: { id: row.roleId, key: row.roleKey, name: row.roleName },
    scope,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt.toISOString(),
  };
}

function forbidden(): ForbiddenException {
  return new ForbiddenException(FORBIDDEN_DETAIL);
}

function auditScope(scope: Scope): Record<string, unknown> {
  return scope.type === 'project' ? { type: 'project', projectId: scope.projectId } : { type: 'org' };
}

async function projectExists(tx: Tx, orgId: string, projectId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.id, projectId)))
    .limit(1);
  return rows.length > 0;
}

@Injectable()
export class AssignmentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OrgsService) private readonly orgs: OrgsService,
  ) {}

  /**
   * Member actor: no `assignment:create` at the target scope → 403 before anything is looked up. Then role in org
   * (else 422 /roleId), allowed at the scope type (else 422 /roleId), project in org (else 422 /scope/projectId),
   * user is a member (else 422 /userId, the same for unknown users), and `checkTenantAssign` (else 403). The insert
   * is `on conflict do nothing` on the unique key, not read-then-insert: only the call that inserted writes the
   * `assignment.granted` audit entry and answers `created: true`; a repeat gets the existing row.
   */
  async grant(
    actor: Actor,
    orgId: string,
    req: CreateAssignmentRequest,
  ): Promise<{ created: boolean; assignment: AssignmentDto }> {
    if (actor.kind === 'platform_admin') await this.orgs.requireOrg(orgId);
    else if (
      !can(actor.access, 'assignment:create', req.scope.type === 'project' ? { projectId: req.scope.projectId } : {})
    ) {
      throw forbidden();
    }
    return withOrg(this.db, orgId, async (tx) => {
      const role = await loadRole(tx, req.roleId);
      if (!role || !role.assignableScopes.includes(req.scope.type)) {
        throw new UnprocessableProblemException('Role not allowed here', [
          {
            pointer: '/roleId',
            detail: 'this role does not exist in the organization or cannot be given at this scope',
          },
        ]);
      }
      if (req.scope.type === 'project' && !(await projectExists(tx, orgId, req.scope.projectId))) {
        throw new UnprocessableProblemException('Project not found', [
          { pointer: '/scope/projectId', detail: 'this project does not exist in the organization' },
        ]);
      }
      const isMember = await tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, req.userId)))
        .limit(1);
      if (!isMember[0]) {
        throw new UnprocessableProblemException('User not found', [
          { pointer: '/userId', detail: 'this person is not a member of the organization' },
        ]);
      }
      if (actor.kind === 'member' && !checkTenantAssign(actor.access, 'assignment:create', role, req.scope).ok) {
        throw forbidden();
      }

      const projectId = req.scope.type === 'project' ? req.scope.projectId : null;
      const inserted = await tx
        .insert(roleAssignments)
        .values({
          orgId,
          userId: req.userId,
          roleId: role.id,
          scopeType: req.scope.type,
          projectId,
          grantedBy: actorUserId(actor),
        })
        .onConflictDoNothing()
        .returning({ id: roleAssignments.id });
      const created = inserted.length > 0;
      if (created) {
        await writeAuditEntry(tx, {
          orgId,
          actorUserId: actorUserId(actor),
          actorKind: actor.kind === 'member' ? 'member' : 'platform_admin',
          action: 'assignment.granted',
          targetType: 'user',
          targetId: req.userId,
          payload: { to: { roleId: role.id, roleKey: role.key, scope: auditScope(req.scope) } },
          projectIds: projectId === null ? [] : [projectId],
        });
      }
      const [row] = await tx
        .select(assignmentColumns)
        .from(roleAssignments)
        .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
        .where(
          and(
            eq(roleAssignments.orgId, orgId),
            eq(roleAssignments.userId, req.userId),
            eq(roleAssignments.roleId, role.id),
            projectId === null ? isNull(roleAssignments.projectId) : eq(roleAssignments.projectId, projectId),
          ),
        )
        .limit(1);
      // only a revoke between the conflict and this read can leave nothing here
      if (!row) throw new ConflictProblemException('Assignment changed, try again', []);
      return { created, assignment: toAssignmentDto(row) };
    });
  }

  /**
   * Member actor: with `projectId` → a project outside every grant is 404, then `assignment:read` there else 403;
   * without → org-scope holders see all, others see the projects they hold `assignment:read` on (none → 403).
   * Platform actor: everything, or the project asked for (404 when it is not in the org).
   */
  async list(actor: Actor, orgId: string, q: AssignmentListQuery): Promise<Page<AssignmentDto>> {
    let visible: 'all' | string[] = 'all';
    if (actor.kind === 'platform_admin') {
      await this.orgs.requireOrg(orgId);
    } else {
      visible = this.visibleFor(actor.access, q.projectId);
    }
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      if (q.projectId !== undefined && !(await projectExists(tx, orgId, q.projectId))) {
        throw new NotFoundException('Project not found');
      }
      const filters: SQL[] = [eq(roleAssignments.orgId, orgId)];
      if (q.projectId !== undefined) filters.push(eq(roleAssignments.projectId, q.projectId));
      else if (visible !== 'all') filters.push(inArray(roleAssignments.projectId, visible));
      const where = and(...filters);
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(roleAssignments)
        .where(where);
      const rows = await tx
        .select(assignmentColumns)
        .from(roleAssignments)
        .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
        .where(where)
        .orderBy(desc(roleAssignments.grantedAt), asc(roleAssignments.id))
        .limit(limit)
        .offset(offset);
      return toPage(rows.map(toAssignmentDto), counted?.total ?? 0, q);
    });
  }

  /**
   * Member actor: no `assignment:delete` anywhere → 403 before anything is looked up. Then a missing assignment, or
   * another org's (RLS hides it), is 404; `checkTenantAssign` on the assignment's own role and scope (else 403); and
   * removing the org's last owner assignment is 409. A platform actor skips the rights and the last-owner rule (orgs
   * start ownerless after deploy). The owner rows are locked while they are counted, so two owners revoking each
   * other at once cannot both pass. Delete and the `assignment.revoked` audit entry share the transaction.
   */
  async revoke(actor: Actor, orgId: string, assignmentId: string): Promise<void> {
    if (actor.kind === 'platform_admin') await this.orgs.requireOrg(orgId);
    else if (!holdsAnywhere(actor.access, 'assignment:delete')) throw forbidden();
    await withOrg(this.db, orgId, async (tx) => {
      const [row] = await tx
        .select(assignmentColumns)
        .from(roleAssignments)
        .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
        .where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.id, assignmentId)))
        .limit(1);
      const role = row ? await loadRole(tx, row.roleId) : null;
      if (!row || !role) throw new NotFoundException('Assignment not found');
      const dto = toAssignmentDto(row);
      if (actor.kind === 'member') {
        if (!checkTenantAssign(actor.access, 'assignment:delete', role, dto.scope).ok) throw forbidden();
        if (role.key === 'owner' && dto.scope.type === 'org') await this.requireAnotherOwner(tx, orgId, row.id);
      }
      const removed = await tx
        .delete(roleAssignments)
        .where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.id, row.id)))
        .returning({ id: roleAssignments.id });
      if (removed.length === 0) throw new NotFoundException('Assignment not found');
      await writeAuditEntry(tx, {
        orgId,
        actorUserId: actorUserId(actor),
        actorKind: actor.kind === 'member' ? 'member' : 'platform_admin',
        action: 'assignment.revoked',
        targetType: 'user',
        targetId: row.userId,
        payload: { from: { roleId: role.id, roleKey: role.key, scope: auditScope(dto.scope) } },
        projectIds: dto.scope.type === 'project' ? [dto.scope.projectId] : [],
      });
    });
  }

  /** The caller's access in the active org as the self route shows it (every grant with its lines). */
  accessOf(access: Access, platformAdmin: boolean): AccessDto {
    return {
      userId: access.userId,
      platformAdmin,
      assignments: access.grants.map((g) => ({
        roleKey: g.roleKey,
        scope: g.scope.type === 'project' ? { type: 'project', projectId: g.scope.projectId } : { type: 'org' },
        permissions: g.lines.map((l) => ({ permission: l.permission, condition: l.condition })),
      })),
    };
  }

  /**
   * Locks every org-scope owner assignment of the org (in id order), then refuses with 409 when `targetId` is the
   * only one. A target that the lock no longer finds was removed by a concurrent revoke: 404.
   */
  private async requireAnotherOwner(tx: Tx, orgId: string, targetId: string): Promise<void> {
    const owners = await tx
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .innerJoin(roles, and(eq(roles.orgId, roleAssignments.orgId), eq(roles.id, roleAssignments.roleId)))
      .where(and(eq(roleAssignments.orgId, orgId), eq(roleAssignments.scopeType, 'org'), eq(roles.key, 'owner')))
      .orderBy(asc(roleAssignments.id))
      .for('update', { of: roleAssignments });
    if (!owners.some((o) => o.id === targetId)) throw new NotFoundException('Assignment not found');
    if (owners.length <= 1) {
      throw new ConflictProblemException('The organization needs at least one owner', []);
    }
  }

  private visibleFor(access: Access, projectId: string | undefined): 'all' | string[] {
    if (projectId !== undefined) {
      if (!inScope(access, projectId)) throw new NotFoundException('Project not found');
      if (!can(access, 'assignment:read', { projectId })) throw forbidden();
      return [projectId];
    }
    const visible = visibleProjects(access, 'assignment:read');
    if (visible !== 'all' && visible.length === 0) throw forbidden();
    return visible;
  }
}
