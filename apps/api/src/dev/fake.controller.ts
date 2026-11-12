import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { connections, projects } from '@agentdesk/db';
import {
  FAKE_SIGNATURE_HEADER,
  FakeStore,
  fakeSignature,
  systemClock,
  type AdapterRegistry,
  type PostedComment,
} from '@agentdesk/core';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import { OrgDb } from '../auth/org-context';
import { ZodPipe } from '../common/zod-validation';
import { CONFIG, type Config } from '../config/config.module';
import { IntakeService } from '../intake/intake.service';

/** Strict `owner/name`; everything here is untrusted input that ends up in file paths and queries. */
const RepoPath = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'must be "owner/name"')
  .refine((p) => p.split('/').every((s) => s !== '.' && s !== '..'), 'path segments must not be "." or ".."');

const Label = z.union([
  z
    .string()
    .min(1)
    .max(100)
    .transform((name) => ({ name, color: '888888' })),
  z.object({ name: z.string().min(1).max(100), color: z.string().regex(/^[0-9a-fA-F]{6}$/) }),
]);

export const DevTicketBody = z.object({
  repoPath: RepoPath,
  number: z.number().int().positive().max(1_000_000_000),
  kind: z.enum(['issue', 'pr']),
  title: z.string().min(1).max(500),
  labels: z.array(Label).max(50).default([]),
});

export const DevCommentBody = z.object({
  repoPath: RepoPath,
  ticketNumber: z.number().int().positive().max(1_000_000_000),
  body: z.string().max(20_000),
  author: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,60}$/)
    .default('dev-user'),
  authorAssociation: z
    .enum(['OWNER', 'MEMBER', 'COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE'])
    .default('OWNER'),
  deliver: z.enum(['webhook', 'poll']),
  /** Which project's connection the webhook is for; default: the newest project in the session org on `repoPath`. */
  projectId: z.uuid().optional(),
});

export const DevPostedQuery = z.object({ repoPath: RepoPath });

const TicketPipe = new ZodPipe(DevTicketBody);
const CommentPipe = new ZodPipe(DevCommentBody);
const PostedPipe = new ZodPipe(DevPostedQuery);

/**
 * Dev-only fake board controls (`ENABLE_FAKE_PROVIDER` and not production; otherwise 404). `/dev/*` is not under /api,
 * but SessionGuard still requires a session here, and the connection lookup runs under that session's org.
 */
@Controller('dev/fake')
export class FakeController {
  private readonly store: FakeStore;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(OrgDb) private readonly orgDb: OrgDb,
    @Inject(IntakeService) private readonly intake: IntakeService,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
  ) {
    this.store = new FakeStore(config.FAKE_STATE_DIR, systemClock);
  }

  private assertEnabled(): void {
    if (!this.config.ENABLE_FAKE_PROVIDER || this.config.NODE_ENV === 'production') {
      throw new NotFoundException('Not found');
    }
  }

  @Post('tickets')
  @HttpCode(201)
  async addTicket(@Body(TicketPipe) body: z.output<typeof DevTicketBody>): Promise<{ ok: true }> {
    this.assertEnabled();
    await this.store.addTicket({
      repoPath: body.repoPath,
      number: body.number,
      kind: body.kind,
      title: body.title,
      labels: body.labels,
    });
    return { ok: true };
  }

  @Post('comments')
  @HttpCode(201)
  async addComment(
    @Body(CommentPipe) body: z.output<typeof DevCommentBody>,
  ): Promise<{ commentId: string; outcome: string; runId?: string }> {
    this.assertEnabled();
    const ticketRef = String(body.ticketNumber);
    // Resolve the project first so a bad projectId leaves no orphan comment behind.
    const externalId =
      body.deliver === 'webhook' ? await this.connectionExternalId(body.repoPath, body.projectId) : undefined;
    const comment = await this.store.addComment({
      repoPath: body.repoPath,
      ticketRef,
      body: body.body,
      author: body.author,
      authorAssociation: body.authorAssociation,
    });
    // Polled comments are picked up by the project's poller, as on a real board.
    if (externalId === undefined) return { commentId: comment.id, outcome: 'queued_for_poll' };

    const ticket = await this.store.getTicket(body.repoPath, body.ticketNumber);
    const payload = Buffer.from(
      JSON.stringify({
        deliveryId: `dev-${randomUUID()}`,
        commentId: comment.id,
        repoPath: body.repoPath,
        ticketRef,
        ...(ticket ? { ticketKind: ticket.kind } : {}),
        body: body.body,
        author: body.author,
        authorAssociation: body.authorAssociation,
        createdAt: comment.createdAt,
        externalId,
      }),
    );
    const headers = { [FAKE_SIGNATURE_HEADER]: fakeSignature(payload, this.config.FAKE_WEBHOOK_SECRET) };
    const event = await this.registry.board('fake').verifyAndParseWebhook(headers, payload, async () => undefined);
    if (event === 'bad_signature' || event === null) throw new BadRequestException('Could not build a webhook event');
    const result = await this.intake.process(event, 'webhook');
    return { commentId: comment.id, outcome: result.outcome, ...(result.runId ? { runId: result.runId } : {}) };
  }

  @Get('posted')
  async posted(@Query(PostedPipe) query: z.output<typeof DevPostedQuery>): Promise<PostedComment[]> {
    this.assertEnabled();
    return (await this.store.listPosted()).filter((c) => c.repoPath === query.repoPath);
  }

  /** The `externalId` of the board connection of a project in the session's org. */
  private async connectionExternalId(repoPath: string, projectId: string | undefined): Promise<string> {
    const rows = await this.orgDb.run((tx) =>
      tx
        .select({ externalId: connections.externalId })
        .from(projects)
        .innerJoin(connections, eq(connections.id, projects.boardConnectionId))
        .where(
          projectId
            ? and(eq(projects.id, projectId), eq(projects.repoPath, repoPath))
            : eq(projects.repoPath, repoPath),
        )
        .orderBy(desc(projects.createdAt))
        .limit(1),
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Project not found');
    return row.externalId;
  }
}
