import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { invitations, member, projects, roles, user, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  InvitationStatus,
  pageWindow,
  toPage,
  type CreateInvitationRequest,
  type InvitationDto,
  type Page,
  type PageQuery,
  type RoleRef,
} from '@agentdesk/contracts';
import { actorUserId, type Actor } from '../access/actor';
import { FORBIDDEN_DETAIL } from '../access/authorize';
import { writeAuditEntry } from '../audit/audit-entry';
import { isUniqueViolation } from '../common/pg-errors';
import { ConflictProblemException, UnprocessableProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { OrgsService } from '../orgs/orgs.service';
import { loadRole } from '../orgs/roles';

/** SQL fragment: an invitation expires this long after creation. Computed in SQL (`now()`), never in JS. */
export const INVITATION_TTL = "interval '7 days'";

/** A row of `invitations`; `status` is the effective one (a pending row past `expires_at` reads `expired`). */
export type InvitationRow = typeof invitations.$inferSelect;

interface ProjectRef {
  id: string;
  name: string;
}

/** Pending rows past their expiry read as `expired`; the stored status is only rewritten when a row is touched. */
const effectiveStatus = sql<string>`case when ${invitations.status} = 'pending' and ${invitations.expiresAt} <= now() then 'expired' else ${invitations.status} end`;
const invitationColumns = { ...getTableColumns(invitations), status: effectiveStatus };

export function toInvitationDto(row: InvitationRow, role: RoleRef, projectRefs: ProjectRef[]): InvitationDto {
  const base = {
    id: row.id,
    email: row.email,
    role,
    status: InvitationStatus.parse(row.status),
    expiresAt: row.expiresAt.toISOString(),
    invitedBy: row.invitedBy,
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

async function roleRefs(tx: Tx, ids: string[]): Promise<Map<string, RoleRef>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: roles.id, key: roles.key, name: roles.name })
    .from(roles)
    .where(inArray(roles.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

async function projectRefs(tx: Tx, orgId: string, ids: string[]): Promise<ProjectRef[]> {
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
  ) {}

  /**
   * Role in org and allowed at the scope type, else 422 /roleId; projects in org, else 422 /scope/projectIds/<i>;
   * existing member with that email → 409 /email ("grant instead"); an expired pending row for (org,email) is set
   * 'expired' (audit invitation.expired) first; a live pending one → 409 /email (unique key, not read-then-insert).
   * Audit invitation.created. Tenant-actor rules are added by Task 20 (until then a tenant actor is refused).
   */
  async create(actor: Actor, orgId: string, req: CreateInvitationRequest): Promise<InvitationDto> {
    requirePlatformAdmin(actor);
    await this.orgs.requireOrg(orgId);
    try {
      return await withOrg(this.db, orgId, async (tx) => {
        const role = await loadRole(tx, req.roleId);
        if (!role || !role.assignableScopes.includes(req.scope.type)) {
          throw new UnprocessableProblemException('Role not allowed here', [
            {
              pointer: '/roleId',
              detail: 'this role does not exist in the organization or cannot be given at this scope',
            },
          ]);
        }
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
        const stale = await tx
          .update(invitations)
          .set({ status: 'expired' })
          .where(
            and(
              eq(invitations.orgId, orgId),
              eq(invitations.email, req.email),
              eq(invitations.status, 'pending'),
              sql`${invitations.expiresAt} <= now()`,
            ),
          )
          .returning();
        const staleRoles = await roleRefs(tx, [...new Set(stale.map((s) => s.roleId))]);
        for (const row of stale) {
          const staleRole = staleRoles.get(row.roleId);
          await writeAuditEntry(tx, {
            orgId,
            actorUserId: actorId,
            actorKind: 'platform_admin',
            action: 'invitation.expired',
            targetType: 'invitation',
            targetId: row.id,
            payload: auditPayload(row, { id: row.roleId, key: staleRole?.key ?? '' }),
          });
        }

        const [row] = await tx
          .insert(invitations)
          .values({
            orgId,
            email: req.email,
            roleId: role.id,
            scopeType: req.scope.type,
            projectIds,
            status: 'pending',
            expiresAt: sql`now() + ${sql.raw(INVITATION_TTL)}`,
            invitedBy: actorId,
          })
          .returning();
        if (!row) throw new Error('invitation insert returned no row');
        await writeAuditEntry(tx, {
          orgId,
          actorUserId: actorId,
          actorKind: 'platform_admin',
          action: 'invitation.created',
          targetType: 'invitation',
          targetId: row.id,
          payload: auditPayload(row, role),
        });
        return toInvitationDto(row, { id: role.id, key: role.key, name: role.name }, found);
      });
    } catch (err) {
      // the partial unique key (org, email) where pending: a concurrent create loses here, not on a prior read
      if (isUniqueViolation(err)) throw alreadyInvited();
      throw err;
    }
  }

  /** Every invitation, createdAt desc; status 'expired' for pending rows with expires_at <= now(). */
  async list(actor: Actor, orgId: string, q: PageQuery): Promise<Page<InvitationDto>> {
    requirePlatformAdmin(actor);
    await this.orgs.requireOrg(orgId);
    const { limit, offset } = pageWindow(q);
    return withOrg(this.db, orgId, async (tx) => {
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(invitations)
        .where(eq(invitations.orgId, orgId));
      const rows = await tx
        .select(invitationColumns)
        .from(invitations)
        .where(eq(invitations.orgId, orgId))
        .orderBy(desc(invitations.createdAt), desc(invitations.id))
        .limit(limit)
        .offset(offset);
      const roleMap = await roleRefs(tx, [...new Set(rows.map((r) => r.roleId))]);
      const projectList = await projectRefs(tx, orgId, [...new Set(rows.flatMap((r) => r.projectIds))]);
      const items = rows.flatMap((r) => {
        const role = roleMap.get(r.roleId);
        return role ? [toInvitationDto(r, role, projectList)] : [];
      });
      return toPage(items, counted?.total ?? 0, q);
    });
  }

  /** Missing → 404; computed status not pending → 409; else 'revoked' + audit invitation.revoked. */
  async revoke(actor: Actor, orgId: string, invitationId: string): Promise<void> {
    requirePlatformAdmin(actor);
    await this.orgs.requireOrg(orgId);
    await withOrg(this.db, orgId, async (tx) => {
      const [current] = await tx
        .select(invitationColumns)
        .from(invitations)
        .where(and(eq(invitations.orgId, orgId), eq(invitations.id, invitationId)))
        .limit(1);
      if (!current) throw new NotFoundException('Invitation not found');
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
        actorKind: 'platform_admin',
        action: 'invitation.revoked',
        targetType: 'invitation',
        targetId: row.id,
        payload: auditPayload(row, { id: row.roleId, key: roleMap.get(row.roleId)?.key ?? '' }),
      });
    });
  }
}

/** Fail closed: only the platform controller exists today; tenant rules come with the tenant routes (Task 20). */
function requirePlatformAdmin(actor: Actor): void {
  if (actor.kind !== 'platform_admin') throw new ForbiddenException(FORBIDDEN_DETAIL);
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

function notPending(): ConflictProblemException {
  return new ConflictProblemException('Invitation is not pending', []);
}
