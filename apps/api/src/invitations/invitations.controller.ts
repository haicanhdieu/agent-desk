import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  routes,
  type CreateInvitationRequest,
  type InvitationDto,
  type InvitationListQuery,
  type Page,
} from '@agentdesk/contracts';
import { CurrentAccess, type RequestAuthz } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { InvitationsService } from './invitations.service';

const ListParams = new ZodPipe(routes.invitations.list.params);
const ListQuery = new ZodPipe(routes.invitations.list.query);
const CreateParams = new ZodPipe(routes.invitations.create.params);
const CreateBody = new ZodPipe(routes.invitations.create.body);
const RemoveParams = new ZodPipe(routes.invitations.remove.params);

/**
 * `/api/orgs/:orgId/invitations`: the guard lets through anyone who may invite or read somewhere in the org (and 404s
 * another org's id); the exact rules, by role and scope, are in the service.
 */
@Controller()
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  @Get(routePath(routes.invitations.list))
  list(
    @CurrentAccess() authz: RequestAuthz,
    @Param(ListParams) p: { orgId: string },
    @Query(ListQuery) q: InvitationListQuery,
  ): Promise<Page<InvitationDto>> {
    return this.invitations.list({ kind: 'member', access: authz.access }, p.orgId, q);
  }

  @Post(routePath(routes.invitations.create))
  create(
    @CurrentAccess() authz: RequestAuthz,
    @Param(CreateParams) p: { orgId: string },
    @Body(CreateBody) body: CreateInvitationRequest,
  ): Promise<InvitationDto> {
    return this.invitations.create({ kind: 'member', access: authz.access }, p.orgId, body);
  }

  @Delete(routePath(routes.invitations.remove))
  @HttpCode(204)
  remove(
    @CurrentAccess() authz: RequestAuthz,
    @Param(RemoveParams) p: { orgId: string; invitationId: string },
  ): Promise<void> {
    return this.invitations.revoke({ kind: 'member', access: authz.access }, p.orgId, p.invitationId);
  }
}
