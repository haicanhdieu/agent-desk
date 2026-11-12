import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { connections, projects, withOrg, type Db } from '@agentdesk/db';
import {
  Provider,
  type PutSkillRequest,
  type PutSkillResponse,
  type SkillDto,
  type SkillSummaryDto,
} from '@agentdesk/contracts';
import {
  SkillConflictError,
  SkillNotFoundError,
  type AdapterProject,
  type AdapterRegistry,
  type CodeHostAdapter,
} from '@agentdesk/core';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import type { OrgContext } from '../auth/org-context';
import { DB } from '../db/db.module';

export interface ProjectCodeHost {
  host: CodeHostAdapter;
  project: AdapterProject;
}

@Injectable()
export class SkillsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
  ) {}

  /** The project's code host adapter and the slice of the project it needs. 404 when the project is not in the org. */
  async codeHostFor(org: OrgContext, projectId: string): Promise<ProjectCodeHost> {
    const row = await withOrg(this.db, org.orgId, async (tx) => {
      const rows = await tx
        .select({ repoPath: projects.repoPath, provider: connections.provider, externalId: connections.externalId })
        .from(projects)
        .innerJoin(connections, eq(connections.id, projects.codeConnectionId))
        .where(eq(projects.id, projectId))
        .limit(1);
      return rows[0];
    });
    if (!row) throw new NotFoundException('Project not found');
    return {
      host: this.registry.codeHost(Provider.parse(row.provider)),
      project: { repoPath: row.repoPath, connectionExternalId: row.externalId },
    };
  }

  async list(org: OrgContext, projectId: string): Promise<SkillSummaryDto[]> {
    const { host, project } = await this.codeHostFor(org, projectId);
    return host.listSkills(project);
  }

  async get(org: OrgContext, projectId: string, name: string): Promise<SkillDto> {
    const { host, project } = await this.codeHostFor(org, projectId);
    try {
      return await host.readSkill(project, name);
    } catch (err) {
      throw mapSkillError(err);
    }
  }

  async put(org: OrgContext, projectId: string, name: string, body: PutSkillRequest): Promise<PutSkillResponse> {
    const { host, project } = await this.codeHostFor(org, projectId);
    try {
      return await host.writeSkill(project, name, body.body, body.message, body.sha);
    } catch (err) {
      throw mapSkillError(err);
    }
  }

  async remove(org: OrgContext, projectId: string, name: string, message: string | undefined): Promise<void> {
    const { host, project } = await this.codeHostFor(org, projectId);
    try {
      await host.deleteSkill(project, name, message ?? `Delete skill ${name}`);
    } catch (err) {
      throw mapSkillError(err);
    }
  }
}

function mapSkillError(err: unknown): unknown {
  if (err instanceof SkillNotFoundError) return new NotFoundException('Skill not found');
  if (err instanceof SkillConflictError) return new ConflictException('Skill changed since it was read');
  return err;
}
