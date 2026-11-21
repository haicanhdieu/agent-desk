import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  routes,
  type CreateInvitationRequest,
  type InvitationListQuery,
  type Page,
  type PlatformInvitationDto,
} from '@agentdesk/contracts';
import { CurrentPlatformAdmin, type PlatformAdminContext } from '../access/current-access';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { InvitationsService } from './invitations.service';

const ListParams = new ZodPipe(routes.platform.listInvitations.params);
const ListQuery = new ZodPipe(routes.platform.listInvitations.query);
const CreateParams = new ZodPipe(routes.platform.createInvitation.params);
const CreateBody = new ZodPipe(routes.platform.createInvitation.body);
const ResendParams = new ZodPipe(routes.platform.resendInvitation.params);
const RemoveParams = new ZodPipe(routes.platform.removeInvitation.params);

/** `/api/platform/orgs/:orgId/invitations`: reachable only by a config-listed platform admin (SessionGuard). */
@Controller()
export class PlatformInvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations: InvitationsService) {}

  @Get(routePath(routes.platform.listInvitations))
  list(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param(ListParams) p: { orgId: string },
    @Query(ListQuery) q: InvitationListQuery,
  ): Promise<Page<PlatformInvitationDto>> {
    return this.invitations.list({ kind: 'platform_admin', userId: admin.userId }, p.orgId, q);
  }

  @Post(routePath(routes.platform.createInvitation))
  create(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param(CreateParams) p: { orgId: string },
    @Body(CreateBody) body: CreateInvitationRequest,
  ): Promise<PlatformInvitationDto> {
    return this.invitations.create({ kind: 'platform_admin', userId: admin.userId }, p.orgId, body);
  }

  @Delete(routePath(routes.platform.removeInvitation))
  @HttpCode(204)
  remove(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param(RemoveParams) p: { orgId: string; invitationId: string },
  ): Promise<void> {
    return this.invitations.revoke({ kind: 'platform_admin', userId: admin.userId }, p.orgId, p.invitationId);
  }

  @Post(routePath(routes.platform.resendInvitation))
  @HttpCode(200)
  resend(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param(ResendParams) p: { orgId: string; invitationId: string },
  ): Promise<PlatformInvitationDto> {
    return this.invitations.resend({ kind: 'platform_admin', userId: admin.userId }, p.orgId, p.invitationId);
  }
}
