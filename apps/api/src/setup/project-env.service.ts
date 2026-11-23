import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { projectEnvVars, projects, user, withOrg, type Db, type Tx } from '@agentdesk/db';
import {
  ENV_MAX_TOTAL_BYTES,
  pageWindow,
  toPage,
  type CreateEnvVarRequest,
  type EnvEntryDto,
  type EnvListQuery,
  type Page,
  type UpdateEnvVarRequest,
} from '@agentdesk/contracts';
import type { OrgContext } from '../auth/org-context';
import { CONFIG, type Config } from '../config/config.module';
import { ConflictProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { assertProjectVisible } from '../projects/project-access';

interface EntryRow {
  name: string;
  kind: string;
  value: string | null;
  updatedAt: Date;
  updatedBy: string;
}

function toDto(row: EntryRow): EnvEntryDto {
  return {
    name: row.name,
    kind: row.kind === 'secret' ? 'secret' : 'plain',
    value: row.kind === 'secret' ? null : row.value,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

const entrySize = (name: string, value: string): number =>
  Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8');

@Injectable()
export class ProjectEnvService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async list(org: OrgContext, projectId: string, q: EnvListQuery): Promise<Page<EnvEntryDto>> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const { limit, offset } = pageWindow(q);
      const where = and(eq(projectEnvVars.projectId, projectId), eq(projectEnvVars.kind, q.kind));
      const [counted] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(projectEnvVars)
        .where(where);
      const rows = await tx
        .select({
          name: projectEnvVars.name,
          kind: projectEnvVars.kind,
          value: projectEnvVars.value,
          updatedAt: projectEnvVars.updatedAt,
          updatedBy: sql<string>`coalesce(${user.handle}, ${projectEnvVars.updatedBy})`,
        })
        .from(projectEnvVars)
        .leftJoin(user, eq(user.id, projectEnvVars.updatedBy))
        .where(where)
        .orderBy(asc(sql`${projectEnvVars.name} collate "C"`))
        .limit(limit)
        .offset(offset);
      return toPage(rows.map(toDto), counted?.total ?? 0, q);
    });
  }

  async createVar(org: OrgContext, projectId: string, actor: string, body: CreateEnvVarRequest): Promise<EnvEntryDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      await this.lockProject(tx, projectId);
      const existing = await tx
        .select({ id: projectEnvVars.id })
        .from(projectEnvVars)
        .where(and(eq(projectEnvVars.projectId, projectId), eq(projectEnvVars.name, body.name)))
        .limit(1);
      if (existing[0]) {
        throw new ConflictProblemException('Name already exists', [
          { pointer: '/name', detail: 'An entry with this name already exists.' },
        ]);
      }
      // after the duplicate check, so an existing name is reported as such even at a limit (BR-14)
      await this.checkLimits(tx, projectId, { addEntry: true, deltaBytes: entrySize(body.name, body.value) });
      const [row] = await tx
        .insert(projectEnvVars)
        .values({
          orgId: org.orgId,
          projectId,
          name: body.name,
          kind: 'plain',
          value: body.value,
          sizeBytes: entrySize(body.name, body.value),
          updatedBy: actor,
        })
        .returning({
          name: projectEnvVars.name,
          kind: projectEnvVars.kind,
          value: projectEnvVars.value,
          updatedAt: projectEnvVars.updatedAt,
          updatedBy: projectEnvVars.updatedBy,
        });
      if (!row) throw new Error('env var insert returned no row');
      return toDto({ ...row, updatedBy: await this.handleOf(tx, actor) });
    });
  }

  async updateVar(
    org: OrgContext,
    projectId: string,
    actor: string,
    name: string,
    body: UpdateEnvVarRequest,
  ): Promise<EnvEntryDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      await this.lockProject(tx, projectId);
      const where = and(
        eq(projectEnvVars.projectId, projectId),
        eq(projectEnvVars.name, name),
        eq(projectEnvVars.kind, 'plain'),
      );
      const [current] = await tx.select({ sizeBytes: projectEnvVars.sizeBytes }).from(projectEnvVars).where(where);
      if (!current) throw new NotFoundException('Variable not found');
      const sizeBytes = entrySize(name, body.value);
      await this.checkLimits(tx, projectId, { addEntry: false, deltaBytes: sizeBytes - current.sizeBytes });
      const [row] = await tx
        .update(projectEnvVars)
        .set({ value: body.value, sizeBytes, updatedBy: actor, updatedAt: sql`now()` })
        .where(where)
        .returning({
          name: projectEnvVars.name,
          kind: projectEnvVars.kind,
          value: projectEnvVars.value,
          updatedAt: projectEnvVars.updatedAt,
          updatedBy: projectEnvVars.updatedBy,
        });
      if (!row) throw new NotFoundException('Variable not found');
      return toDto({ ...row, updatedBy: await this.handleOf(tx, actor) });
    });
  }

  async removeVar(org: OrgContext, projectId: string, name: string): Promise<void> {
    await withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const removed = await tx
        .delete(projectEnvVars)
        .where(
          and(eq(projectEnvVars.projectId, projectId), eq(projectEnvVars.name, name), eq(projectEnvVars.kind, 'plain')),
        )
        .returning({ id: projectEnvVars.id });
      if (!removed[0]) throw new NotFoundException('Variable not found');
    });
  }

  /**
   * Takes the project row lock (serialising every env write of the project), then enforces the entry cap (only when a
   * new entry is added) and the 256 KiB total (name and value bytes of both kinds, after the change).
   */
  async lockProjectAndCheck(
    tx: Tx,
    projectId: string,
    change: { addEntry: boolean; deltaBytes: number },
  ): Promise<void> {
    await this.lockProject(tx, projectId);
    await this.checkLimits(tx, projectId, change);
  }

  private async lockProject(tx: Tx, projectId: string): Promise<void> {
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
  }

  /** Caller holds the project lock. Edit and remove stay possible above a lowered cap: only `addEntry` checks it. */
  private async checkLimits(
    tx: Tx,
    projectId: string,
    change: { addEntry: boolean; deltaBytes: number },
  ): Promise<void> {
    const [used] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(${projectEnvVars.sizeBytes}), 0)::int`,
      })
      .from(projectEnvVars)
      .where(eq(projectEnvVars.projectId, projectId));
    const max = this.config.PROJECT_ENV_MAX_ENTRIES;
    if (change.addEntry && (used?.count ?? 0) >= max) {
      throw new ConflictException(`This project already has the maximum of ${max} environment entries.`);
    }
    if (change.deltaBytes > 0 && (used?.bytes ?? 0) + change.deltaBytes > ENV_MAX_TOTAL_BYTES) {
      throw new ConflictException(
        `Names and values together cannot exceed ${ENV_MAX_TOTAL_BYTES} bytes (256 KiB) per project.`,
      );
    }
  }

  private async handleOf(tx: Tx, userId: string): Promise<string> {
    const rows = await tx.select({ handle: user.handle }).from(user).where(eq(user.id, userId)).limit(1);
    return rows[0]?.handle ?? userId;
  }
}
