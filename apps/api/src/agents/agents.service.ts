import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { agents, withOrg, type Db } from '@agentdesk/db';
import {
  CredentialType,
  type AgentDto,
  type PutAgentRequest,
  type PutCredentialRequest,
  type PutCredentialResponse,
} from '@agentdesk/contracts';
import { credentialSecretName, type SecretStore } from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { DB } from '../db/db.module';
import { SECRET_STORE } from '../secrets/secret-store.module';

type AgentRow = typeof agents.$inferSelect;

function toDto(row: AgentRow): AgentDto {
  const type = row.credentialType === null ? null : CredentialType.parse(row.credentialType);
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    provider: 'claude',
    model: row.model,
    maxTurns: row.maxTurns,
    timeoutSeconds: row.timeoutSeconds,
    credential: {
      set: type !== null && row.credentialUpdatedAt !== null,
      type,
      updatedAt: row.credentialUpdatedAt?.toISOString() ?? null,
      setBy: row.credentialSetBy,
    },
  };
}

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
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
        .set({ model: body.model, maxTurns: body.maxTurns ?? null, timeoutSeconds: body.timeoutSeconds })
        .where(eq(agents.projectId, projectId))
        .returning();
      if (!row) throw new NotFoundException('Agent not found');
      return toDto(row);
    });
  }

  async putCredential(org: OrgContext, agentId: string, body: PutCredentialRequest): Promise<PutCredentialResponse> {
    const exists = await withOrg(
      this.db,
      org.orgId,
      async (tx) => (await tx.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).limit(1))[0],
    );
    if (!exists) throw new NotFoundException('Agent not found');
    const name = credentialSecretName(org.orgId, agentId);
    try {
      await this.secrets.put(name, { type: body.type, value: body.value });
    } catch (err) {
      // Log the error class only: a store error message could echo request material.
      this.logger.error(
        `credential store write failed for agent ${agentId}: ${err instanceof Error ? err.name : 'unknown'}`,
      );
      throw new Error('credential store unavailable');
    }
    const updatedAt = new Date();
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
}
