import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  routes,
  type AssignmentDto,
  type AssignmentListQuery,
  type CreateAssignmentRequest,
  type Page,
} from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { AssignmentsService } from './assignments.service';

const ListParams = new ZodPipe(routes.assignments.list.params);
const ListQuery = new ZodPipe(routes.assignments.list.query);
const CreateParams = new ZodPipe(routes.assignments.create.params);
const CreateBody = new ZodPipe(routes.assignments.create.body);
const RemoveParams = new ZodPipe(routes.assignments.remove.params);

/** `/api/orgs/:orgId/assignments`: org-admin routes; the service holds the exact scope and escalation rules. */
@Controller()
export class AssignmentsController {
  constructor(@Inject(AssignmentsService) private readonly assignments: AssignmentsService) {}

  @Get(routePath(routes.assignments.list)) // routes.assignments.list
  list(
    @CurrentAccess() authz: RequestAuthz,
    @Param(ListParams) p: { orgId: string },
    @Query(ListQuery) q: AssignmentListQuery,
  ): Promise<Page<AssignmentDto>> {
    return this.assignments.list({ kind: 'member', access: authz.access }, p.orgId, q);
  }

  /** 201 when created, 200 for a repeat of an existing grant. */
  @Post(routePath(routes.assignments.create)) // routes.assignments.create
  async create(
    @CurrentAccess() authz: RequestAuthz,
    @Param(CreateParams) p: { orgId: string },
    @Body(CreateBody) body: CreateAssignmentRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AssignmentDto> {
    const { created, assignment } = await this.assignments.grant(
      { kind: 'member', access: authz.access },
      p.orgId,
      body,
    );
    void reply.status(created ? 201 : 200);
    return assignment;
  }

  @Delete(routePath(routes.assignments.remove)) // routes.assignments.remove
  @HttpCode(204)
  remove(
    @CurrentAccess() authz: RequestAuthz,
    @Param(RemoveParams) p: { orgId: string; assignmentId: string },
  ): Promise<void> {
    return this.assignments.revoke({ kind: 'member', access: authz.access }, p.orgId, p.assignmentId);
  }
}
