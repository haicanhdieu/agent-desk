import { Controller, Get, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Provider, routes, type ConnectionDto, type InstallResponse, type RepoDto } from '@agentdesk/contracts';
import { CurrentOrg, type OrgContext } from '../auth/org-context';
import { routePath } from '../common/route-path';
import { ZodPipe } from '../common/zod-validation';
import { ConnectionsService } from './connections.service';

const ProviderParam = new ZodPipe(Provider);
const ConnectionIdParam = new ZodPipe(routes.connections.repos.params);
const CallbackQuery = new ZodPipe(z.record(z.string(), z.union([z.string(), z.array(z.string())])));

/** Registered here (not in the route table): the provider redirects the browser to this path after install. */
const CALLBACK_PATH = 'api/connections/:provider/callback';

@Controller()
export class ConnectionsController {
  constructor(@Inject(ConnectionsService) private readonly service: ConnectionsService) {}

  @Get(routePath(routes.connections.list))
  list(@CurrentOrg() org: OrgContext): Promise<ConnectionDto[]> {
    return this.service.list(org.orgId);
  }

  @Post(routePath(routes.connections.install))
  install(@CurrentOrg() org: OrgContext, @Param('provider', ProviderParam) provider: Provider): InstallResponse {
    return this.service.install(org.orgId, org.userId, provider);
  }

  @Get(CALLBACK_PATH)
  async callback(
    @Param('provider', ProviderParam) provider: Provider,
    @Query(CallbackQuery) query: Record<string, string | string[]>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) if (typeof v === 'string') params[k] = v;
    const location = await this.service.complete(provider, params);
    void reply.redirect(location, 302);
  }

  @Get(routePath(routes.connections.repos))
  repos(@CurrentOrg() org: OrgContext, @Param(ConnectionIdParam) params: { connectionId: string }): Promise<RepoDto[]> {
    return this.service.repos(org.orgId, params.connectionId);
  }
}
