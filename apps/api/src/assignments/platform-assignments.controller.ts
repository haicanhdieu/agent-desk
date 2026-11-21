import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  routes,
  type AssignmentListQuery,
  type CreateAssignmentRequest,
  type Page,
  type PlatformAssignmentDto,
} from '@agentdesk/contracts';
import type { Actor } from '../access/actor';
import { CurrentPlatformAdmin, type PlatformAdminContext } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { AssignmentsService } from './assignments.service';

const ListParams = new ZodPipe(routes.platform.listAssignments.params);
const ListQuery = new ZodPipe(routes.platform.listAssignments.query);
const CreateParams = new ZodPipe(routes.platform.createAssignment.params);
const CreateBody = new ZodPipe(routes.platform.createAssignment.body);
const RemoveParams = new ZodPipe(routes.platform.removeAssignment.params);

const asActor = (admin: PlatformAdminContext): Actor => ({ kind: 'platform_admin', userId: admin.userId });

/**
 * `/api/platform/orgs/:orgId/assignments`: reachable only by a config-listed platform admin (SessionGuard,
 * `scope: 'platform'`). The service checks the org exists first, and a platform actor skips the tenant-only rules.
 */
@Controller()
export class PlatformAssignmentsController {
  constructor(@Inject(AssignmentsService) private readonly assignments: AssignmentsService) {}

  @Get(routePath(routes.platform.listAssignments))
  list(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param(ListParams) p: { orgId: string },
    @Query(ListQuery) q: AssignmentListQuery,
  ): Promise<Page<PlatformAssignmentDto>> {
    return this.assignments.list(asActor(admin), p.orgId, q);
  }

  /** 201 when created, 200 for a repeat of an existing grant. */
  @Post(routePath(routes.platform.createAssignment))
  async create(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param(CreateParams) p: { orgId: string },
    @Body(CreateBody) body: CreateAssignmentRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlatformAssignmentDto> {
    const { created, assignment } = await this.assignments.grant(asActor(admin), p.orgId, body);
    void reply.status(created ? 201 : 200);
    return assignment;
  }

  @Delete(routePath(routes.platform.removeAssignment))
  @HttpCode(204)
  remove(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param(RemoveParams) p: { orgId: string; assignmentId: string },
  ): Promise<void> {
    return this.assignments.revoke(asActor(admin), p.orgId, p.assignmentId);
  }
}
