import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { agents, withOrg, type Db } from '@agentdesk/db';
import {
  AgentKind,
  CredentialType,
  type AgentDto,
  type AgentModelsDto,
  type PutAgentRequest,
  type PutCredentialRequest,
  type PutCredentialResponse,
} from '@agentdesk/contracts';
import {
  AgentModelsError,
  agentAdapterFor,
  credentialMatchesAddress,
  credentialSecretData,
  credentialSecretName,
  parseCredentialSecret,
  type AgentHttpGet,
  type SecretStore,
} from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { assertProjectVisible } from '../projects/project-access';
import { SECRET_STORE } from '../secrets/secret-store.module';
import { AGENT_HTTP } from './agent-http.provider';

type AgentRow = typeof agents.$inferSelect;

function toDto(row: AgentRow): AgentDto {
  const type = row.credentialType === null ? null : CredentialType.parse(row.credentialType);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    provider: AgentKind.parse(row.provider),
    model: row.model,
    baseUrl: row.baseUrl,
    maxTurns: row.maxTurns,
    timeoutSeconds: row.timeoutSeconds,
    pausedKeepSeconds: row.pausedKeepSeconds,
    doneKeepSeconds: row.doneKeepSeconds,
    idleEndSeconds: row.idleEndSeconds,
    autoResumeMax: row.autoResumeMax,
    credential: {
      set: type !== null && row.credentialUpdatedAt !== null,
      type,
      updatedAt: row.credentialUpdatedAt?.toISOString() ?? null,
      setBy: row.credentialSetBy,
    },
  };
}

function hostOf(baseUrl: string | null): string {
  if (baseUrl === null) return 'default';
  try {
    return new URL(baseUrl).host;
  } catch {
    return 'invalid';
  }
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(AGENT_HTTP) private readonly http: AgentHttpGet,
  ) {}

  get(org: OrgContext, projectId: string): Promise<AgentDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const row = (await tx.select().from(agents).where(eq(agents.projectId, projectId)).limit(1))[0];
      if (!row) throw new NotFoundException('Agent not found');
      return toDto(row);
    });
  }

  put(org: OrgContext, projectId: string, body: PutAgentRequest): Promise<AgentDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const [row] = await tx
        .update(agents)
        .set({
          model: body.model,
          maxTurns: body.maxTurns ?? null,
          timeoutSeconds: body.timeoutSeconds,
          // Absent keeps the stored value (undefined is skipped by drizzle).
          pausedKeepSeconds: body.pausedKeepSeconds,
          doneKeepSeconds: body.doneKeepSeconds,
          idleEndSeconds: body.idleEndSeconds,
          autoResumeMax: body.autoResumeMax,
        })
        .where(eq(agents.projectId, projectId))
        .returning();
      if (!row) throw new NotFoundException('Agent not found');
      return toDto(row);
    });
  }

  /**
   * Saves a credential. The address it is for travels inside the Secret, and a credential is used only while the
   * agent's address equals it (`credentialMatchesAddress`). No lock or transaction spans a Secret call.
   *
   * An address change (`baseUrl` present) goes in this order (BR-16): (1) a short transaction sets the address and
   * clears the credential metadata, (2) the old Secret is deleted, (3) the new Secret is written with the new address,
   * (4) a short transaction sets the metadata again. A failure at (2) or (3) leaves the new address with no credential
   * ("not set"; a Secret left behind is for the old address, so it is never used). Without `baseUrl` there is one
   * Secret write for the row's current address, then the metadata. If saves interleave, a Secret whose address
   * differs from the agent's reads as "no credential" until the next save.
   */
  async putCredential(org: OrgContext, agentId: string, body: PutCredentialRequest): Promise<PutCredentialResponse> {
    const name = credentialSecretName(org.orgId, agentId);
    let target: string | null;
    if (body.baseUrl !== undefined) {
      const baseUrl = body.baseUrl;
      const changed = await withOrg(this.db, org.orgId, async (tx) => {
        const rows = await tx
          .update(agents)
          .set({
            baseUrl,
            credentialSecretName: null,
            credentialType: null,
            credentialUpdatedAt: null,
            credentialSetBy: null,
          })
          .where(eq(agents.id, agentId))
          .returning({ id: agents.id });
        return rows.length > 0;
      });
      if (!changed) throw new NotFoundException('Agent not found');
      await this.storeCredential(agentId, () => this.secrets.delete(name));
      target = baseUrl;
    } else {
      const current = await withOrg(
        this.db,
        org.orgId,
        async (tx) =>
          (await tx.select({ baseUrl: agents.baseUrl }).from(agents).where(eq(agents.id, agentId)).limit(1))[0],
      );
      if (!current) throw new NotFoundException('Agent not found');
      target = current.baseUrl;
    }
    await this.storeCredential(agentId, () =>
      this.secrets.put(name, credentialSecretData(body.type, body.value, target)),
    );
    const updatedAt = new Date();
    // The address is written only by step (1): this write never moves it.
    await withOrg(this.db, org.orgId, (tx) =>
      tx
        .update(agents)
        .set({
          credentialSecretName: name,
          credentialType: body.type,
          credentialUpdatedAt: updatedAt,
          credentialSetBy: org.userId,
        })
        .where(eq(agents.id, agentId)),
    );
    return { updatedAt: updatedAt.toISOString() };
  }

  private async storeCredential(agentId: string, op: () => Promise<void>): Promise<void> {
    try {
      await op();
    } catch (err) {
      // Log the error class only: a store error message could echo request material.
      this.logger.error(
        `credential store write failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      // eslint-disable-next-line preserve-caught-error -- deliberate: the cause may echo the credential.
      throw new Error('credential store unavailable');
    }
  }

  async models(org: OrgContext, agentId: string): Promise<AgentModelsDto> {
    const agent = await withOrg(this.db, org.orgId, async (tx) => {
      const row = (await tx.select().from(agents).where(eq(agents.id, agentId)).limit(1))[0];
      if (!row) throw new NotFoundException('Agent not found');
      await assertProjectVisible(tx, row.projectId);
      return row;
    });
    const adapter = agentAdapterFor(AgentKind.parse(agent.provider), { http: this.http });
    const fallback = (reason: NonNullable<AgentModelsDto['reason']>): AgentModelsDto => ({
      source: 'builtin',
      reason,
      models: [...adapter.builtinModels],
    });
    if (this.config.AGENT_MODELS_SOURCE === 'builtin') return fallback('disabled');
    if (agent.credentialType === null || agent.credentialUpdatedAt === null) return fallback('no_credential');
    let stored: Record<string, string> | null;
    try {
      stored = await this.secrets.get(credentialSecretName(org.orgId, agentId));
    } catch (err) {
      this.logger.error(
        `credential store read failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      // eslint-disable-next-line preserve-caught-error -- deliberate: the cause may echo secret material.
      throw new Error('credential store unavailable');
    }
    // A missing or unusable Secret, or one saved for another address, is no credential; it is never sent anywhere.
    const credential = parseCredentialSecret(stored);
    if (!credential || !credentialMatchesAddress(credential, agent.baseUrl)) return fallback('no_credential');
    try {
      const list = await adapter.listModels({
        credential: { type: credential.type, value: credential.value },
        baseUrl: agent.baseUrl,
      });
      return list.length === 0 ? fallback('empty') : { source: 'live', reason: null, models: list };
    } catch (err) {
      const kind = err instanceof AgentModelsError ? err.kind : 'unreachable';
      // Class and host only: never the upstream body, the credential or headers.
      this.logger.warn(
        `model list failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'} ${kind} host ${hostOf(agent.baseUrl)}`,
      );
      return fallback(kind === 'rejected' ? 'rejected' : 'unreachable');
    }
  }
}
