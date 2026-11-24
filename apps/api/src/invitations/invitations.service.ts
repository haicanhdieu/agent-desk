import { ConflictException, Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Logger } from 'pino';
import { and, desc, eq, ne, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { invitations, member, projects, roles, user, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  INVITATION_EXPIRY_SECONDS,
  InvitationStatus,
  can,
  holdsAnywhere,
  pageWindow,
  toPage,
  visibleProjects,
  type Access,
  type CreateInvitationRequest,
  type InvitationDto,
  type InvitationListQuery,
  type InviterDto,
  type Page,
  type RoleRef,
} from '@agentdesk/contracts';
import { actorUserId, type Actor } from '../access/actor';
import { FORBIDDEN_DETAIL } from '../access/authorize';
import { checkTenantAssign, type RoleForGrant } from '../access/grant-rules';
import { writeAuditEntry } from '../audit/audit-entry';
import { writePlatformAuditEntry } from '../audit/platform-audit-entry';
import { isUniqueViolation } from '../common/pg-errors';
import { ConflictProblemException, UnprocessableProblemException } from '../common/zod-validation';
import { LOGGER } from '../common/logger';
import { requestContext } from '../common/request-context';
import { DB } from '../db/db.module';
import { OrgsService } from '../orgs/orgs.service';
import { loadRole } from '../orgs/roles';
import { toInviterDto } from './inviter';

/** A row of `invitations`; `status` is the effective one (a pending row past `expires_at` reads `expired`). */
export type InvitationRow = typeof invitations.$inferSelect;

export interface ProjectRef {
  id: string;
  name: string;
}

/** Pending rows past their expiry read as `expired`; the stored status is only rewritten when a row is touched. */
export const effectiveStatus = sql<string>`case when ${invitations.status} = 'pending' and ${invitations.expiresAt} <= now() then 'expired' else ${invitations.status} end`;
const invitationColumns = { ...getTableColumns(invitations), status: effectiveStatus };

export function toInvitationDto(
  row: InvitationRow,
  role: RoleRef,
  projectRefs: ProjectRef[],
  invitedBy: InviterDto | null,
): InvitationDto {
  const base = {
    id: row.id,
    email: row.email,
    role,
    status: InvitationStatus.parse(row.status),
    expiresAt: row.expiresAt.toISOString(),
    invitedBy,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt === null ? null : row.acceptedAt.toISOString(),
  };
  if (row.scopeType === 'project') {
    const byId = new Map(projectRefs.map((p) => [p.id, p]));
    // a project deleted since is left out; the stored id order is kept
    const listed = row.projectIds.flatMap((id) => {
      const p = byId.get(id);
      return p ? [{ id: p.id, name: p.name }] : [];
    });
    return { ...base, scope: { type: 'project', projects: listed } };
  }
  return { ...base, scope: { type: 'org' } };
}

/** The platform audit payload of an invitation: who is invited, the role key and the scope (never the token or link). */
async function writePlatformInvitationEntry(
  tx: Tx,
  actor: Actor,
  action: 'invitation.created' | 'invitation.resent' | 'invitation.revoked',
  row: InvitationRow,
  roleKey: string,
): Promise<void> {
  if (actor.kind !== 'platform_admin') return;
  await writePlatformAuditEntry(tx, {
    actorUserId: actor.userId,
    action,
    targetType: 'invitation',
    targetId: row.id,
    targetOrgId: row.orgId,
    payload: {
      email: row.email,
      roleKey,
      scope: row.scopeType === 'project' ? { type: 'project', projectIds: row.projectIds } : { type: 'org' },
    },
  });
}

function auditPayload(row: InvitationRow, role: { id: string; key: string }): Record<string, unknown> {
  return {
    email: row.email,
    to: {
      roleId: role.id,
      roleKey: role.key,
      scope: row.scopeType === 'project' ? { type: 'project', projectIds: row.projectIds } : { type: 'org' },
    },
  };
}

/**
 * Pending rows of (org, email) past their expiry are set 'expired' (audit invitation.expired) so the pending-email
 * unique key only counts live ones; `exceptId` leaves one row alone (the one being resent).
 */
async function expireStalePending(
  tx: Tx,
  orgId: string,
  email: string,
  actor: Actor,
  exceptId?: string,
): Promise<void> {
  const stale = await tx
    .update(invitations)
    .set({ status: 'expired' })
    .where(
      and(
        eq(invitations.orgId, orgId),
        eq(invitations.email, email),
        eq(invitations.status, 'pending'),
        sql`${invitations.expiresAt} <= now()`,
        exceptId === undefined ? undefined : ne(invitations.id, exceptId),
      ),
    )
    .returning();
  const staleRoles = await roleRefs(tx, [...new Set(stale.map((s) => s.roleId))]);
  for (const row of stale) {
    const staleRole = staleRoles.get(row.roleId);
    await writeAuditEntry(tx, {
      orgId,
      actorUserId: actorUserId(actor),
      actorKind: actor.kind,
      action: 'invitation.expired',
      targetType: 'invitation',
      targetId: row.id,
      payload: auditPayload(row, { id: row.roleId, key: staleRole?.key ?? '' }),
      projectIds: row.projectIds,
    });
  }
}

export async function roleRefs(tx: Tx, ids: string[]): Promise<Map<string, RoleRef>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: roles.id, key: roles.key, name: roles.name })
    .from(roles)
    .where(inArray(roles.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function projectRefs(tx: Tx, orgId: string, ids: string[]): Promise<ProjectRef[]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), inArray(projects.id, ids)));
}

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OrgsService) private readonly orgs: OrgsService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Role in org and allowed at the scope type, else 422 /roleId; projects in org, else 422 /scope/projectIds/<i>;
   * existing member with that email → 409 /email ("grant instead"); an expired pending row for (org,email) is set
   * 'expired' (audit invitation.expired) first; a live pending one → 409 /email (unique key, not read-then-insert).
   * Audit invitation.created. A member actor passes the grant rules first: a check on the caller's own access before any
   * lookup (so nothing about a target leaks), then the role-based rules, both 403 and both before any 422. A platform
   * admin has no subset rule.
   */
  async create(actor: Actor, orgId: string, req: CreateInvitationRequest): Promise<InvitationDto> {
    if (actor.kind === 'member' && !mayStartInvite(actor.access, req.scope)) throw forbidden();
    await this.orgs.requireOrg(orgId);
    try {
      return await withOrg(this.db, orgId, async (tx) => {
        const role = await loadRole(tx, req.roleId);
        if (!role) throw badRole();
        // the grant rules (403) come before the scope check (422): a project admin asking for `owner` is refused
        if (actor.kind === 'member' && !mayInvite(actor.access, role, req.scope)) throw forbidden();
        if (!role.assignableScopes.includes(req.scope.type)) throw badRole();
        const projectIds = req.scope.type === 'project' ? req.scope.projectIds : [];
        const found = await projectRefs(tx, orgId, projectIds);
        const foundIds = new Set(found.map((p) => p.id));
        const missing = projectIds.findIndex((id) => !foundIds.has(id));
        if (missing !== -1) {
          throw new UnprocessableProblemException('Project not found', [
            { pointer: `/scope/projectIds/${missing}`, detail: 'this project does not exist in the organization' },
          ]);
        }

        const existing = await tx
          .select({ userId: member.userId })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(and(eq(member.organizationId, orgId), sql`lower(${user.email}) = ${req.email}`))
          .limit(1);
        if (existing[0]) throw alreadyMember();

        const actorId = actorUserId(actor);
        await expireStalePending(tx, orgId, req.email, actor);

        const [row] = await tx
          .insert(invitations)
          .values({
            orgId,
            email: req.email,
            roleId: role.id,
            scopeType: req.scope.type,
            projectIds,
            status: 'pending',
            expiresAt: sql`now() + make_interval(secs => ${INVITATION_EXPIRY_SECONDS})`,
            invitedBy: actorId,
          })
          .returning();
        if (!row) throw new Error('invitation insert returned no row');
        await writeAuditEntry(tx, {
          orgId,
          actorUserId: actorId,
          actorKind: actor.kind,
          action: 'invitation.created',
          targetType: 'invitation',
          targetId: row.id,
          payload: auditPayload(row, role),
          projectIds: row.projectIds,
        });
        await writePlatformInvitationEntry(tx, actor, 'invitation.created', row, role.key);
        return toInvitationDto(
          row,
          { id: role.id, key: role.key, name: role.name },
          found,
          await inviterOf(tx, row.invitedBy),
        );
      });
    } catch (err) {
      // the partial unique key (org, email) where pending: a concurrent create loses here, not on a prior read
      if (isUniqueViolation(err)) throw alreadyInvited();
      throw err;
    }
  }

  /**
   * Invitations filtered by `q.status` (default pending; `all` for every status), createdAt desc; effective status is
   * 'expired' for pending rows with expires_at <= now(). A member actor without
   * `member:read` at org scope sees only project invitations whose every project they can read assignments on.
   */
  async list(actor: Actor, orgId: string, q: InvitationListQuery): Promise<Page<InvitationDto>> {
    const visible = visibilityFilter(actor);
    await this.orgs.requireOrg(orgId);
    const { limit, offset } = pageWindow(q);
    const where = and(eq(invitations.orgId, orgId), visible, statusFilter(q.status));
    return withOrg(this.db, orgId, async (tx) => {
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(invitations)
        .where(where);
      const rows = await tx
        .select({ ...invitationColumns, inviterName: user.name, inviterHandle: user.handle })
        .from(invitations)
        .leftJoin(user, eq(user.id, invitations.invitedBy))
        .where(where)
        .orderBy(desc(invitations.createdAt), desc(invitations.id))
        .limit(limit)
        .offset(offset);
      const roleMap = await roleRefs(tx, [...new Set(rows.map((r) => r.roleId))]);
      const projectList = await projectRefs(tx, orgId, [...new Set(rows.flatMap((r) => r.projectIds))]);
      const items = rows.flatMap((r) => {
        const role = roleMap.get(r.roleId);
        if (!role) return [];
        const inviter = r.inviterName === null ? null : { name: r.inviterName, handle: r.inviterHandle };
        return [toInvitationDto(r, role, projectList, toInviterDto(inviter))];
      });
      return toPage(items, counted?.total ?? 0, q);
    });
  }

  /**
   * Missing or another org's → 404; the revoke rights check → 403; then one statement sets a pending or expired row
   * to pending with a fresh expiry (zero rows → 409; the pending-email unique key → 409 /email). Audit
   * invitation.resent in the same transaction.
   */
  async resend(actor: Actor, orgId: string, invitationId: string): Promise<InvitationDto> {
    if (actor.kind === 'member' && !holdsInviteRight(actor.access)) throw forbidden();
    await this.orgs.requireOrg(orgId);
    try {
      const dto = await withOrg(this.db, orgId, async (tx) => {
        const [current] = await tx
          .select(invitationColumns)
          .from(invitations)
          .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)))
          .limit(1);
        if (!current) throw new NotFoundException('Invitation not found');
        // the role FK is ON DELETE restrict, so a missing role is an invariant break: fail closed
        const role = await loadRole(tx, current.roleId);
        if (!role) throw new NotFoundException('Invitation not found');
        if (actor.kind === 'member') {
          const scope =
            current.scopeType === 'project'
              ? { type: 'project' as const, projectIds: current.projectIds }
              : { type: 'org' as const };
          if (!mayInvite(actor.access, role, scope)) throw forbidden();
        }
        await expireStalePending(tx, orgId, current.email, actor, invitationId);
        const [row] = await tx
          .update(invitations)
          .set({ status: 'pending', expiresAt: sql`now() + make_interval(secs => ${INVITATION_EXPIRY_SECONDS})` })
          .where(
            and(
              eq(invitations.orgId, orgId),
              eq(invitations.id, invitationId),
              inArray(invitations.status, ['pending', 'expired']),
            ),
          )
          .returning();
        if (!row) throw new ConflictException('Invitation is no longer pending');
        await writeAuditEntry(tx, {
          orgId,
          actorUserId: actorUserId(actor),
          actorKind: actor.kind,
          action: 'invitation.resent',
          targetType: 'invitation',
          targetId: row.id,
          payload: { expiresAt: row.expiresAt.toISOString() },
          projectIds: row.projectIds,
        });
        await writePlatformInvitationEntry(tx, actor, 'invitation.resent', row, role.key);
        const projectList = await projectRefs(tx, orgId, row.projectIds);
        return toInvitationDto(
          row,
          { id: role.id, key: role.key, name: role.name },
          projectList,
          await inviterOf(tx, row.invitedBy),
        );
      });
      this.logger.info({ requestId: requestContext.get()?.requestId, orgId, invitationId }, 'invitation resent');
      return dto;
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyPending();
      throw err;
    }
  }

  /** Missing → 404; computed status not pending → 409; else 'revoked' + audit invitation.revoked. */
  async revoke(actor: Actor, orgId: string, invitationId: string): Promise<void> {
    if (actor.kind === 'member' && !holdsInviteRight(actor.access)) throw forbidden();
    await this.orgs.requireOrg(orgId);
    await withOrg(this.db, orgId, async (tx) => {
      const [current] = await tx
        .select(invitationColumns)
        .from(invitations)
        .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)))
        .limit(1);
      if (!current) throw new NotFoundException('Invitation not found');
      if (actor.kind === 'member') {
        // whoever could have created it: the create rules on the stored role and scope; a role that is gone fails closed
        const role = await loadRole(tx, current.roleId);
        const scope =
          current.scopeType === 'project'
            ? { type: 'project' as const, projectIds: current.projectIds }
            : { type: 'org' as const };
        if (!role || !mayInvite(actor.access, role, scope)) throw forbidden();
      }
      if (current.status !== 'pending') throw notPending();
      // the status and expiry are checked again in the write itself, so a concurrent revoke or expiry gives 409
      const [row] = await tx
        .update(invitations)
        .set({ status: 'revoked' })
        .where(
          and(
            eq(invitations.orgId, orgId),
            eq(invitations.id, invitationId),
            eq(invitations.status, 'pending'),
            sql`${invitations.expiresAt} > now()`,
          ),
        )
        .returning();
      if (!row) throw notPending();
      const roleMap = await roleRefs(tx, [row.roleId]);
      await writeAuditEntry(tx, {
        orgId,
        actorUserId: actorUserId(actor),
        actorKind: actor.kind,
        action: 'invitation.revoked',
        targetType: 'invitation',
        targetId: row.id,
        payload: auditPayload(row, { id: row.roleId, key: roleMap.get(row.roleId)?.key ?? '' }),
        projectIds: row.projectIds,
      });
      await writePlatformInvitationEntry(tx, actor, 'invitation.revoked', row, roleMap.get(row.roleId)?.key ?? '');
    });
  }
}

/** Which rows a list shows: `pending` means stored pending and not yet past expiry; `expired` includes those past it. */
function statusFilter(status: InvitationListQuery['status']): SQL | undefined {
  return status === 'all' ? undefined : sql`${effectiveStatus} = ${status}`;
}

async function inviterOf(tx: Tx, userId: string): Promise<InviterDto | null> {
  const [row] = await tx
    .select({ name: user.name, handle: user.handle })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return toInviterDto(row);
}

type InviteScope = { type: 'org' } | { type: 'project'; projectIds: string[] };

function forbidden(): ForbiddenException {
  return new ForbiddenException(FORBIDDEN_DETAIL);
}

/** The caller can invite somewhere at all: `member:create` at org scope or `assignment:create` on some project. */
function holdsInviteRight(access: Access): boolean {
  return can(access, 'member:create') || holdsAnywhere(access, 'assignment:create');
}

/**
 * Checks that need only the caller's access, so they run before any role or project lookup: org scope needs
 * `member:create` at org scope; project scope needs `assignment:create` on every listed project.
 */
function mayStartInvite(access: Access, scope: InviteScope): boolean {
  if (scope.type === 'org') return can(access, 'member:create');
  return scope.projectIds.every((projectId) => can(access, 'assignment:create', { projectId }));
}

/**
 * The tenant grant rules for `role` at `scope` (checkTenantAssign): org scope also needs `member:create` at org scope;
 * project scope needs the rules to pass on every listed project. Owner is given only by an org owner; the role's lines
 * must be held by the caller at that scope. Anything else is refused.
 */
function mayInvite(access: Access, role: RoleForGrant, scope: InviteScope): boolean {
  if (!mayStartInvite(access, scope)) return false;
  if (scope.type === 'org') return checkTenantAssign(access, 'assignment:create', role, { type: 'org' }).ok;
  return scope.projectIds.every(
    (projectId) => checkTenantAssign(access, 'assignment:create', role, { type: 'project', projectId }).ok,
  );
}

/**
 * Which rows the actor may list. Platform admin and `member:read` at org scope: all. Otherwise project invitations whose
 * every project the caller can read assignments on; none of that: 403.
 */
function visibilityFilter(actor: Actor): SQL | undefined {
  if (actor.kind === 'platform_admin') return undefined;
  const access = actor.access;
  if (can(access, 'member:read')) return undefined;
  const projects = visibleProjects(access, 'assignment:read');
  if (projects !== 'all' && projects.length === 0) throw forbidden();
  const onlyProjects = eq(invitations.scopeType, 'project');
  if (projects === 'all') return onlyProjects;
  const ids = sql.join(
    projects.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  return and(onlyProjects, sql`${invitations.projectIds} <@ array[${ids}]::uuid[]`);
}

function badRole(): UnprocessableProblemException {
  return new UnprocessableProblemException('Role not allowed here', [
    {
      pointer: '/roleId',
      detail: 'this role does not exist in the organization or cannot be given at this scope',
    },
  ]);
}

function alreadyMember(): ConflictProblemException {
  return new ConflictProblemException('Already a member', [
    { pointer: '/email', detail: 'this person is already a member of the organization; grant a role instead' },
  ]);
}

function alreadyInvited(): ConflictProblemException {
  return new ConflictProblemException('Already invited', [
    { pointer: '/email', detail: 'this address already has a pending invitation; revoke it first' },
  ]);
}

function alreadyPending(): ConflictProblemException {
  return new ConflictProblemException('Already invited', [
    { pointer: '/email', detail: 'This email already has a pending invitation.' },
  ]);
}

function notPending(): ConflictProblemException {
  return new ConflictProblemException('Invitation is not pending', []);
}
