import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  routes,
  type AcceptInvitationResponse,
  type MyInvitationDto,
  type Page,
  type PageQuery,
} from '@agentdesk/contracts';
import { CurrentSessionUser, type SessionUser } from '../access/session-user';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { MyInvitationsService } from './my-invitations.service';

const ListQuery = new ZodPipe(routes.me.listInvitations.query);
const IdParams = new ZodPipe(routes.me.getInvitation.params);

/** `/api/me/invitations`: a signed-in user's own invitations. No org, no membership; the org header is ignored. */
@Controller()
export class MyInvitationsController {
  constructor(@Inject(MyInvitationsService) private readonly mine: MyInvitationsService) {}

  @Get(routePath(routes.me.listInvitations))
  list(@CurrentSessionUser() user: SessionUser, @Query(ListQuery) q: PageQuery): Promise<Page<MyInvitationDto>> {
    return this.mine.list(user, q);
  }

  @Get(routePath(routes.me.getInvitation))
  get(@CurrentSessionUser() user: SessionUser, @Param(IdParams) p: { invitationId: string }): Promise<MyInvitationDto> {
    return this.mine.get(user, p.invitationId);
  }

  @Post(routePath(routes.me.acceptInvitation))
  @HttpCode(200)
  accept(
    @CurrentSessionUser() user: SessionUser,
    @Param(IdParams) p: { invitationId: string },
  ): Promise<AcceptInvitationResponse> {
    return this.mine.accept(user, p.invitationId);
  }

  @Post(routePath(routes.me.declineInvitation))
  @HttpCode(204)
  decline(@CurrentSessionUser() user: SessionUser, @Param(IdParams) p: { invitationId: string }): Promise<void> {
    return this.mine.decline(user, p.invitationId);
  }
}
