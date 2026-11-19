import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { agents, projects, rules, runs, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  RuleTarget,
  type PromptPreviewDto,
  type CreateRuleRequest,
  type RuleDto,
  type UpdateRuleRequest,
} from '@agentdesk/contracts';
import { PROMPT_PREVIEW_ARGS, PROMPT_PREVIEW_TICKET, promptSystemLines, SkillNotFoundError } from '@agentdesk/core';
import type { OrgContext } from '../auth/org-context';
import { DB } from '../db/db.module';
import { isUniqueViolation } from '../common/pg-errors';
import { ConflictProblemException, UnprocessableProblemException } from '../common/zod-validation';
import { SkillsService } from '../skills/skills.service';

type RuleRow = typeof rules.$inferSelect;

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function duplicateCommand(): ConflictProblemException {
  return new ConflictProblemException('Command already used', [
    { pointer: '/command', detail: 'Command already used' },
  ]);
}

@Injectable()
export class RulesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SkillsService) private readonly skills: SkillsService,
  ) {}

  private async statsFor(tx: Tx, ruleIds: string[]): Promise<Map<string, { runs30d: number; lastRunAt: Date | null }>> {
    const out = new Map<string, { runs30d: number; lastRunAt: Date | null }>();
    if (ruleIds.length === 0) return out;
    const since = new Date(Date.now() - WINDOW_MS);
    const rows = await tx
      .select({
        ruleId: runs.ruleId,
        runs30d: sql<number>`count(*) filter (where ${gte(runs.queuedAt, since)})::int`,
        lastRunAt: sql<Date | null>`max(${runs.queuedAt})`,
      })
      .from(runs)
      .where(inArray(runs.ruleId, ruleIds))
      .groupBy(runs.ruleId);
    for (const r of rows) {
      if (r.ruleId)
        out.set(r.ruleId, { runs30d: r.runs30d, lastRunAt: r.lastRunAt === null ? null : new Date(r.lastRunAt) });
    }
    return out;
  }

  private toDto(row: RuleRow, stats: { runs30d: number; lastRunAt: Date | null } | undefined): RuleDto {
    return {
      id: row.id,
      projectId: row.projectId,
      command: row.command,
      labelFilter: row.labelFilter,
      target: RuleTarget.parse(row.target),
      agentId: row.agentId,
      model: row.model,
      kind: row.prompt !== null ? 'prompt' : 'skill',
      skillName: row.skillName,
      prompt: row.prompt,
      enabled: row.enabled,
      stats: { runs30d: stats?.runs30d ?? 0, lastRunAt: stats?.lastRunAt?.toISOString() ?? null },
    };
  }

  async promptPreview(org: OrgContext, projectId: string): Promise<PromptPreviewDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const [project] = await tx
        .select({ repoPath: projects.repoPath })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!project) throw new NotFoundException('Project not found');
      return {
        systemLines: promptSystemLines({
          ticket: PROMPT_PREVIEW_TICKET,
          repoPath: project.repoPath,
          args: PROMPT_PREVIEW_ARGS,
        }),
      };
    });
  }

  private async dtoOf(tx: Tx, row: RuleRow): Promise<RuleDto> {
    return this.toDto(row, (await this.statsFor(tx, [row.id])).get(row.id));
  }

  /** 422 pointing at /skillName unless the skill exists in the project's repository. */
  private async assertSkillExists(org: OrgContext, projectId: string, skillName: string): Promise<void> {
    const { host, project } = await this.skills.codeHostFor(org, projectId);
    try {
      await host.readSkill(project, skillName);
    } catch (err) {
      if (err instanceof SkillNotFoundError) {
        throw new UnprocessableProblemException('Unknown skill', [
          { pointer: '/skillName', detail: 'Skill not found in the repository' },
        ]);
      }
      throw err;
    }
  }

  /**
   * The agent a rule runs with: `agentId` when it belongs to the project (422 on /agentId otherwise), else the
   * project's own agent (404 when the project is not visible to the org).
   */
  private async resolveAgent(tx: Tx, projectId: string, agentId: string | undefined): Promise<{ id: string }> {
    const found = (
      await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          agentId === undefined
            ? eq(agents.projectId, projectId)
            : and(eq(agents.projectId, projectId), eq(agents.id, agentId)),
        )
        .limit(1)
    )[0];
    if (found) return found;
    const visible = (await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1))[0];
    if (!visible || agentId === undefined) throw new NotFoundException('Project not found');
    throw new UnprocessableProblemException('Unknown agent', [
      { pointer: '/agentId', detail: 'Agent not found in this project' },
    ]);
  }

  list(org: OrgContext, projectId: string): Promise<RuleDto[]> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const project = (await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)))[0];
      if (!project) throw new NotFoundException('Project not found');
      const rows = await tx.select().from(rules).where(eq(rules.projectId, projectId)).orderBy(rules.createdAt);
      const stats = await this.statsFor(
        tx,
        rows.map((r) => r.id),
      );
      return rows.map((r) => this.toDto(r, stats.get(r.id)));
    });
  }

  async create(org: OrgContext, projectId: string, body: CreateRuleRequest): Promise<RuleDto> {
    if (body.kind === 'skill') await this.assertSkillExists(org, projectId, body.skillName);
    try {
      return await withOrg(this.db, org.orgId, async (tx) => {
        const agent = await this.resolveAgent(tx, projectId, body.agentId);
        const [row] = await tx
          .insert(rules)
          .values({
            orgId: org.orgId,
            projectId,
            command: body.command,
            labelFilter: body.labelFilter,
            target: body.target,
            agentId: agent.id,
            model: body.model ?? null,
            skillName: body.kind === 'skill' ? body.skillName : null,
            prompt: body.kind === 'prompt' ? body.prompt : null,
            enabled: body.enabled,
          })
          .returning();
        if (!row) throw new Error('rule insert returned no row');
        return this.dtoOf(tx, row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateCommand();
      throw err;
    }
  }

  async update(org: OrgContext, ruleId: string, body: UpdateRuleRequest): Promise<RuleDto> {
    const existing = await withOrg(
      this.db,
      org.orgId,
      async (tx) => (await tx.select().from(rules).where(eq(rules.id, ruleId)).limit(1))[0],
    );
    if (!existing) throw new NotFoundException('Rule not found');
    const existingKind = existing.prompt !== null ? 'prompt' : 'skill';
    const kind = body.kind ?? existingKind;
    const mismatch = (pointer: string): UnprocessableProblemException =>
      new UnprocessableProblemException('Rule kind mismatch', [
        { pointer, detail: 'Send kind to switch what this rule runs' },
      ]);
    if (kind === 'skill' && body.prompt !== undefined) throw mismatch('/prompt');
    if (kind === 'prompt' && body.skillName !== undefined) throw mismatch('/skillName');
    if (kind === 'skill' && body.skillName !== undefined && body.skillName !== existing.skillName) {
      await this.assertSkillExists(org, existing.projectId, body.skillName);
    }
    const set: Partial<typeof rules.$inferInsert> = {};
    if (body.command !== undefined) set.command = body.command;
    if (body.labelFilter !== undefined) set.labelFilter = body.labelFilter;
    if (body.target !== undefined) set.target = body.target;
    if (kind === 'skill' && body.skillName !== undefined) {
      set.skillName = body.skillName;
      set.prompt = null;
    }
    if (kind === 'prompt' && body.prompt !== undefined) {
      set.prompt = body.prompt;
      set.skillName = null;
    }
    if (body.enabled !== undefined) set.enabled = body.enabled;
    if (body.model !== undefined) set.model = body.model;
    try {
      return await withOrg(this.db, org.orgId, async (tx) => {
        if (body.agentId !== undefined)
          set.agentId = (await this.resolveAgent(tx, existing.projectId, body.agentId)).id;
        const row =
          Object.keys(set).length === 0
            ? (await tx.select().from(rules).where(eq(rules.id, ruleId)))[0]
            : (await tx.update(rules).set(set).where(eq(rules.id, ruleId)).returning())[0];
        if (!row) throw new NotFoundException('Rule not found');
        return this.dtoOf(tx, row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw duplicateCommand();
      throw err;
    }
  }

  async remove(org: OrgContext, ruleId: string): Promise<void> {
    await withOrg(this.db, org.orgId, async (tx) => {
      const deleted = await tx
        .delete(rules)
        .where(and(eq(rules.id, ruleId)))
        .returning({ id: rules.id });
      if (deleted.length === 0) throw new NotFoundException('Rule not found');
    });
  }
}
