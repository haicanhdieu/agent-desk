import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Provider } from '@agentdesk/contracts';
import type { AdapterRegistry, BoardAdapter } from '@agentdesk/core';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import { IntakeService } from './intake.service';

export interface WebhookResponse {
  outcome: string;
}

/** Public (no session): authenticity comes from the provider's signature, checked before any database write. */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(IntakeService) private readonly intake: IntakeService,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
  ) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') providerParam: string,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<WebhookResponse> {
    const provider = Provider.safeParse(providerParam);
    if (!provider.success) throw new NotFoundException('Unknown provider');
    let board: BoardAdapter;
    try {
      board = this.registry.board(provider.data);
    } catch {
      throw new NotFoundException('Unknown provider');
    }
    const raw = req.rawWebhookBody;
    if (!raw) throw new BadRequestException('Missing request body');

    // Secrets are resolved by the adapter (config default); no per-connection secret store exists yet.
    const event = await board.verifyAndParseWebhook(req.headers, raw, async () => undefined);
    if (event === 'bad_signature') throw new UnauthorizedException('Invalid signature');
    if (event === null) return { outcome: 'ignored' };

    const result = await this.intake.process(event, 'webhook');
    if (result.outcome === 'run_created') void reply.status(202);
    return { outcome: result.outcome };
  }
}
