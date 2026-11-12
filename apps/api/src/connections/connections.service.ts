import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { account, connections, member, organization, pollCursors, projects, withOrg, type Db } from '@agentdesk/db';
import { Provider, type ConnectionDto, type InstallResponse, type RepoDto } from '@agentdesk/contracts';
import type { AdapterRegistry } from '@agentdesk/core';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import { isUniqueViolation } from '../common/pg-errors';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { ProjectSchedules } from '../projects/project-schedules';
import { signState, verifyState } from './install-state';

type ConnectionRow = typeof connections.$inferSelect;

export function toConnectionDto(row: ConnectionRow): ConnectionDto {
  const status = row.status === 'suspended' || row.status === 'revoked' ? row.status : 'active';
  return {
    id: row.id,
    provider: Provider.parse(row.provider),
    capabilities: row.capabilities,
    accountName: row.accountName,
    status,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
    @Inject(ProjectSchedules) private readonly schedules: ProjectSchedules,
  ) {}

  private requireProvider(provider: Provider): void {
    if (!this.registry.providers().includes(provider))
      throw new BadRequestException(`Provider "${provider}" is not enabled`);
  }

  async list(orgId: string): Promise<ConnectionDto[]> {
    const rows = await withOrg(this.db, orgId, (tx) => tx.select().from(connections).orderBy(connections.createdAt));
    return rows.map(toConnectionDto);
  }

  install(orgId: string, userId: string, provider: Provider): InstallResponse {
    this.requireProvider(provider);
    const state = signState(this.config.BETTER_AUTH_SECRET, { orgId, userId });
    return { url: this.registry.codeHost(provider).installUrl(orgId, state) };
  }

  /**
   * Verifies the signed state, completes the install at the provider and upserts the connection. Returns the redirect
   * target. The state binds {orgId, userId}: only that user (session) may redeem it, and must still be a member of the
   * org. Replay by the same user is harmless: the upsert is idempotent (same provider account, same org).
   */
  async complete(provider: Provider, params: Record<string, string>, sessionUserId: string): Promise<string> {
    const identity = verifyState(this.config.BETTER_AUTH_SECRET, params['state'] ?? '');
    if (!identity) throw new BadRequestException('Invalid or expired install state');
    if (identity.userId !== sessionUserId) throw new ForbiddenException('Install state belongs to another user');
    const { orgId, userId } = identity;
    const membership = await this.db.orm
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1);
    if (!membership[0]) throw new ForbiddenException('Not a member of the organization');
    this.requireProvider(provider);

    const linked = await this.db.orm
      .select({ token: account.accessToken })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, provider)))
      .limit(1);
    const fresh = await this.registry
      .codeHost(provider)
      .completeInstall(params, { userId, orgId, linkedAccountToken: linked[0]?.token ?? null });

    let row: ConnectionRow;
    try {
      row = await withOrg(this.db, orgId, async (tx) => {
        const existing = await tx
          .select()
          .from(connections)
          .where(and(eq(connections.provider, fresh.provider), eq(connections.externalId, fresh.externalId)))
          .limit(1);
        if (existing[0]) {
          const [updated] = await tx
            .update(connections)
            .set({
              accountName: fresh.accountName,
              capabilities: fresh.capabilities,
              status: 'active',
              linkedByUserId: userId,
            })
            .where(eq(connections.id, existing[0].id))
            .returning();
          return updated ?? existing[0];
        }
        const [inserted] = await tx
          .insert(connections)
          .values({
            orgId,
            provider: fresh.provider,
            externalId: fresh.externalId,
            accountName: fresh.accountName,
            capabilities: fresh.capabilities,
            linkedByUserId: userId,
          })
          .returning();
        if (!inserted) throw new Error('connection insert returned no row');
        return inserted;
      });
    } catch (err) {
      // (provider, external_id) is unique across orgs; a row owned by another org is invisible under RLS.
      if (isUniqueViolation(err)) throw new ConflictException('Connection already exists');
      throw err;
    }

    await this.resumeRevokedPolling(orgId, row.id);

    const org = await this.db.orm
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1);
    const slug = org[0]?.slug;
    if (!slug) throw new BadRequestException('Invalid or expired install state');
    return `${this.config.PUBLIC_ORIGIN}/o/${encodeURIComponent(slug)}/projects/new/repo?connection=${row.id}`;
  }

  /**
   * The connection is healthy again: polling projects that were paused as `token_revoked` resume. The cursor is
   * cleared in the database first; unpausing the Schedule is best-effort (the daily sync/next edit repairs it).
   */
  private async resumeRevokedPolling(orgId: string, connectionId: string): Promise<void> {
    const resumed = await withOrg(this.db, orgId, async (tx) => {
      const rows = await tx
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(pollCursors, eq(pollCursors.projectId, projects.id))
        .where(
          and(
            eq(projects.boardConnectionId, connectionId),
            eq(projects.triggerMode, 'polling'),
            eq(pollCursors.pausedReason, 'token_revoked'),
          ),
        );
      for (const { id } of rows) {
        await tx
          .update(pollCursors)
          .set({ pausedReason: null, lastError: null, failures: 0, nextPollAt: null })
          .where(eq(pollCursors.projectId, id));
      }
      return rows.map((r) => r.id);
    });
    for (const projectId of resumed) {
      try {
        await this.schedules.unpause(projectId);
      } catch (err) {
        this.logger.warn(
          `unpause poll schedule failed for project ${projectId}: ${err instanceof Error ? err.name : 'error'}`,
        );
      }
    }
  }

  async repos(orgId: string, connectionId: string): Promise<RepoDto[]> {
    const row = await withOrg(this.db, orgId, async (tx) => {
      const rows = await tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
      return rows[0];
    });
    if (!row) throw new NotFoundException('Connection not found');
    return this.registry.codeHost(Provider.parse(row.provider)).listRepos({ externalId: row.externalId });
  }
}
