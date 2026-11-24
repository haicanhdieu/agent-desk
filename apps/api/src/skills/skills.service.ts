import { BadGatewayException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { connections, projects, withOrg, type Db } from '@agentdesk/db';
import {
  Provider,
  slicePage,
  type Page,
  type PageQuery,
  type PutSkillRequest,
  type DeleteSkillResponse,
  type PutSkillResponse,
  type SkillDto,
  type SkillSummaryDto,
} from '@agentdesk/contracts';
import {
  SkillBranchExistsError,
  SkillChangeRequestError,
  SkillConflictError,
  SkillNotFoundError,
  toAdapterProject,
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
        .select({
          repoPath: projects.repoPath,
          defaultBranch: projects.defaultBranch,
          provider: connections.provider,
          externalId: connections.externalId,
        })
        .from(projects)
        .innerJoin(connections, eq(connections.id, projects.codeConnectionId))
        .where(eq(projects.id, projectId))
        .limit(1);
      return rows[0];
    });
    if (!row) throw new NotFoundException('Project not found');
    return {
      host: this.registry.codeHost(Provider.parse(row.provider)),
      project: toAdapterProject(row, row.externalId),
    };
  }

  async list(org: OrgContext, projectId: string, q: PageQuery): Promise<Page<SkillSummaryDto>> {
    const { host, project } = await this.codeHostFor(org, projectId);
    // Skill names are lowercase slugs, so code-unit order is A to Z.
    const sorted = [...(await host.listSkills(project))].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    return slicePage(sorted, q);
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

  async remove(
    org: OrgContext,
    projectId: string,
    name: string,
    message: string | undefined,
  ): Promise<DeleteSkillResponse> {
    const { host, project } = await this.codeHostFor(org, projectId);
    try {
      return await host.deleteSkill(project, name, message ?? `Delete skill ${name}`);
    } catch (err) {
      throw mapSkillError(err);
    }
  }
}

function mapSkillError(err: unknown): unknown {
  if (err instanceof SkillNotFoundError) return new NotFoundException('Skill not found');
  if (err instanceof SkillConflictError) return new ConflictException('Skill changed since it was read');
  if (err instanceof SkillBranchExistsError) {
    return new ConflictException('A change request branch with that name already exists. Submit again.');
  }
  // Fixed texts only: provider errors never reach the client.
  if (err instanceof SkillChangeRequestError) {
    if (err.stage === 'permission') {
      return new BadGatewayException(
        'The code host refused the change request. Check that the connection can write to this repository.',
      );
    }
    const texts = {
      branch: 'Could not create a branch for the change request. Try again, or check the repository.',
      commit: 'Could not save the skill to the new branch. Try again, or check the repository.',
      change_request: 'Could not open the change request. Try again, or check the repository.',
    } as const;
    return new BadGatewayException(texts[err.stage]);
  }
  return err;
}
