import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { connections, organization, pollCursors, projects, withOrg, type Db } from '@agentdesk/db';
import { Provider, can, type ConnectionDto, type InstallResponse, type RepoDto } from '@agentdesk/contracts';
import { loadAccess, type AdapterRegistry, type NewConnection } from '@agentdesk/core';
import { orgMembership } from '../access/check-access';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import { OrgSuspendedException } from '../common/org-suspended';
import { isUniqueViolation } from '../common/pg-errors';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { ProjectSchedules } from '../projects/project-schedules';
import { ProviderTokens } from './provider-tokens';
import { signState, verifyState } from './install-state';

type ConnectionRow = typeof connections.$inferSelect;

/** The provider's installation settings page, kept in `config.manageUrl`; null when the provider gave none. */
function manageUrlOf(config: ConnectionRow['config']): string | null {
  const url = config['manageUrl'];
  return typeof url === 'string' ? url : null;
}

export function toConnectionDto(row: ConnectionRow): ConnectionDto {
  const status = row.status === 'suspended' || row.status === 'revoked' ? row.status : 'active';
  return {
    id: row.id,
    provider: Provider.parse(row.provider),
    capabilities: row.capabilities,
    accountName: row.accountName,
    status,
    manageUrl: manageUrlOf(row.config),
    createdAt: row.createdAt.toISOString(),
  };
}

/** `config` with the provider's manage URL set or, when the provider gave none this time, left as it was. */
function withManageUrl(config: ConnectionRow['config'], manageUrl: string | null | undefined): ConnectionRow['config'] {
  return manageUrl ? { ...config, manageUrl } : config;
}

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
    @Inject(ProjectSchedules) private readonly schedules: ProjectSchedules,
    @Inject(ProviderTokens) private readonly tokens: ProviderTokens,
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
   * org and still hold connection:create at org scope. Replay by the same user is harmless: the upsert is idempotent (same provider account, same org).
   */
  async complete(provider: Provider, params: Record<string, string>, sessionUserId: string): Promise<string> {
    const identity = verifyState(this.config.BETTER_AUTH_SECRET, params['state'] ?? '');
    if (!identity) throw new BadRequestException('Invalid or expired install state');
    if (identity.userId !== sessionUserId) throw new ForbiddenException('Install state belongs to another user');
    const { orgId, userId } = identity;
    // The state's org is not the guard's pinned (session) org, so the guard's membership and org-active checks do not
    // cover it: decide both here. A non-member keeps the plain 403 and never learns the org's status.
    const membership = await orgMembership(this.db, { userId, orgId });
    if (membership === 'none') throw new ForbiddenException('Not a member of the organization');
    if (membership === 'suspended') {
      this.logger.log(`org suspended orgId=${orgId} userId=${userId} routeKey=connections.callback`);
      throw new OrgSuspendedException();
    }
    // The state was minted earlier, possibly for another org than the session's active one, and the user's grants may
    // have changed since: re-check connection:create at org scope now, under the state's org. Fails closed.
    const access = await withOrg(this.db, orgId, (tx) => loadAccess(tx, userId));
    if (!can(access, 'connection:create')) throw new ForbiddenException('Not allowed for your role here');
    this.requireProvider(provider);

    const linkedAccountToken = await this.tokens.userToken(userId, provider);
    const fresh = await this.registry.codeHost(provider).completeInstall(params, { userId, orgId, linkedAccountToken });

    let row: ConnectionRow;
    try {
      row = await this.upsert(orgId, userId, fresh);
    } catch (err) {
      // (org_id, provider, external_id) is unique: a concurrent callback for the same org inserted it first.
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

  /** Inserts the connection, or refreshes and re-activates it when this org already has it (idempotent). */
  private upsert(orgId: string, userId: string, fresh: NewConnection): Promise<ConnectionRow> {
    return withOrg(this.db, orgId, async (tx) => {
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
            config: withManageUrl(existing[0].config, fresh.manageUrl),
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
          config: withManageUrl({}, fresh.manageUrl),
          linkedByUserId: userId,
        })
        .returning();
      if (!inserted) throw new Error('connection insert returned no row');
      return inserted;
    });
  }

  /**
   * Links installations the user's own provider account can already see. The provider only redirects back to
   * `complete` on a fresh install, so an app installed earlier (e.g. before this org was set up) never gets a
   * connection that way. An installation another org already linked is linked here too: the user's own provider
   * account proves access, and each org holds its own connection row.
   */
  async sync(orgId: string, userId: string, provider: Provider): Promise<ConnectionDto[]> {
    this.requireProvider(provider);
    const linkedAccountToken = await this.tokens.userToken(userId, provider);
    const found = await this.registry.codeHost(provider).listInstallations({ userId, orgId, linkedAccountToken });
    for (const fresh of found) {
      try {
        const row = await this.upsert(orgId, userId, fresh);
        await this.resumeRevokedPolling(orgId, row.id);
      } catch (err) {
        // A concurrent sync for this org inserted the same installation first; it is linked either way.
        if (!isUniqueViolation(err)) throw err;
      }
    }
    return this.list(orgId);
  }

  /**
   * The connection is healthy again: polling projects paused as `token_revoked` resume. Each Schedule is unpaused
   * first; only projects whose unpause succeeded get their `token_revoked` reason cleared. A failed unpause keeps the
   * reason (the Schedule is still paused), so the next successful callback retries it.
   */
  private async resumeRevokedPolling(orgId: string, connectionId: string): Promise<void> {
    const candidates = await withOrg(this.db, orgId, (tx) =>
      tx
        .select({ id: projects.id })
        .from(projects)
        .innerJoin(pollCursors, eq(pollCursors.projectId, projects.id))
        .where(
          and(
            eq(projects.boardConnectionId, connectionId),
            eq(projects.triggerMode, 'polling'),
            eq(pollCursors.pausedReason, 'token_revoked'),
          ),
        ),
    );
    const resumed: string[] = [];
    for (const { id } of candidates) {
      try {
        await this.schedules.unpause(id);
        resumed.push(id);
      } catch (err) {
        this.logger.warn(
          `unpause poll schedule failed for project ${id}: ${err instanceof Error ? err.name : 'error'}`,
        );
      }
    }
    if (resumed.length === 0) return;
    await withOrg(this.db, orgId, (tx) =>
      tx
        .update(pollCursors)
        .set({ pausedReason: null, lastError: null, failures: 0, nextPollAt: null })
        .where(and(inArray(pollCursors.projectId, resumed), eq(pollCursors.pausedReason, 'token_revoked'))),
    );
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
