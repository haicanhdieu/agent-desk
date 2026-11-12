import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  agents,
  connections,
  inboundEvents,
  pollCursors,
  projects,
  runs,
  withOrg,
  type Db,
  type Tx,
} from '@agentdesk/db';
import {
  PollInterval,
  Provider,
  SetupStep,
  TriggerMode,
  type CreateProjectRequest,
  type ProjectConnectionDto,
  type ProjectDto,
  type UpdateProjectRequest,
} from '@agentdesk/contracts';
import type { OrgContext } from '../auth/org-context';
import { isUniqueViolation } from '../common/pg-errors';
import { credentialSecretName, type AdapterRegistry, type SecretStore } from '@agentdesk/core';
import { ADAPTER_REGISTRY } from '../adapters/adapter-registry.module';
import { ValidationProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { SECRET_STORE } from '../secrets/secret-store.module';
import { ProjectSchedules } from './project-schedules';

type ProjectRow = typeof projects.$inferSelect;

const REPO_SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_REPO_PATH = 200;

function repoPathProblem(detail: string): ValidationProblemException {
  return new ValidationProblemException([{ pointer: '/repoPath', detail }]);
}

/** Strict `owner/name`: two segments of [A-Za-z0-9._-], none of them '.' or '..'. */
export function assertRepoPathShape(repoPath: string): void {
  const parts = repoPath.split('/');
  if (
    repoPath.length > MAX_REPO_PATH ||
    parts.length !== 2 ||
    parts.some((p) => !REPO_SEGMENT.test(p) || p === '.' || p === '..')
  ) {
    throw repoPathProblem('must be "owner/name" using letters, digits, ".", "_" or "-"');
  }
}

/** Non-final run statuses: a project with any of these cannot be deleted. */
const LIVE_STATUSES = ['queued', 'starting', 'running', 'idle'];

/** 409: deleting a project while it has live runs would orphan their workflows, Jobs and tokens. */
export class ActiveRunsConflictException extends ConflictException {
  constructor() {
    super('Cancel active runs first: this project has queued or running runs');
  }
}

const STEP_ORDER: readonly SetupStep[] = ['agent', 'skills', 'rules', 'ready'];

interface Counts {
  needsYou: number;
  running: number;
  queued: number;
  lastRunAt: Date | null;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ADAPTER_REGISTRY) private readonly registry: AdapterRegistry,
    @Inject(ProjectSchedules) private readonly schedules: ProjectSchedules,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
  ) {}

  /** One grouped query for all requested projects. needsYou = idle runs; running = live jobs (starting, running, idle). */
  private async countsFor(tx: Tx, projectIds: string[]): Promise<Map<string, Counts>> {
    const out = new Map<string, Counts>();
    if (projectIds.length === 0) return out;
    const rows = await tx
      .select({
        projectId: runs.projectId,
        needsYou: sql<number>`count(*) filter (where ${runs.status} = 'idle')::int`,
        running: sql<number>`count(*) filter (where ${runs.status} in ('starting','running','idle'))::int`,
        queued: sql<number>`count(*) filter (where ${runs.status} = 'queued')::int`,
        lastRunAt: sql<Date | null>`max(${runs.queuedAt})`,
      })
      .from(runs)
      .where(inArray(runs.projectId, projectIds))
      .groupBy(runs.projectId);
    for (const r of rows) {
      out.set(r.projectId, {
        needsYou: r.needsYou,
        running: r.running,
        queued: r.queued,
        lastRunAt: r.lastRunAt === null ? null : new Date(r.lastRunAt),
      });
    }
    return out;
  }

  private toDto(row: ProjectRow, counts: Counts | undefined): ProjectDto {
    return {
      id: row.id,
      name: row.name,
      repoPath: row.repoPath,
      codeConnectionId: row.codeConnectionId,
      boardConnectionId: row.boardConnectionId,
      triggerMode: TriggerMode.parse(row.triggerMode),
      pollIntervalSeconds: PollInterval.parse(row.pollIntervalSeconds),
      maxConcurrentRuns: row.maxConcurrentRuns,
      maxRunsPerTicket: row.maxRunsPerTicket,
      setupStep: SetupStep.parse(row.setupStep),
      createdAt: row.createdAt.toISOString(),
      counts: { needsYou: counts?.needsYou ?? 0, running: counts?.running ?? 0, queued: counts?.queued ?? 0 },
      lastRunAt: counts?.lastRunAt?.toISOString() ?? null,
    };
  }

  private async dtoOf(tx: Tx, row: ProjectRow): Promise<ProjectDto> {
    const counts = await this.countsFor(tx, [row.id]);
    return this.toDto(row, counts.get(row.id));
  }

  private async load(tx: Tx, projectId: string, lock = false): Promise<ProjectRow> {
    const q = tx.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const rows = await (lock ? q.for('update') : q);
    const row = rows[0];
    if (!row) throw new NotFoundException('Project not found');
    return row;
  }

  /**
   * External work after the DB commit (Temporal, secret store): a failure is logged and never fails the request. Only
   * the error's name is logged: store and provider messages can quote values.
   */
  private async bestEffort(what: string, fn: () => Promise<void>, projectId: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn(`${what} failed for project ${projectId}: ${err instanceof Error ? err.name : 'unknown error'}`);
    }
  }

  async list(org: OrgContext): Promise<ProjectDto[]> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const rows = await tx.select().from(projects).orderBy(projects.createdAt);
      const counts = await this.countsFor(
        tx,
        rows.map((r) => r.id),
      );
      return rows.map((r) => this.toDto(r, counts.get(r.id)));
    });
  }

  get(org: OrgContext, projectId: string): Promise<ProjectDto> {
    return withOrg(this.db, org.orgId, async (tx) => this.dtoOf(tx, await this.load(tx, projectId)));
  }

  async create(org: OrgContext, body: CreateProjectRequest): Promise<ProjectDto> {
    assertRepoPathShape(body.repoPath);
    const conn = await withOrg(
      this.db,
      org.orgId,
      async (tx) => (await tx.select().from(connections).where(eq(connections.id, body.connectionId)).limit(1))[0],
    );
    if (!conn) throw new NotFoundException('Connection not found');
    // Provider call happens outside any transaction.
    const accessible = await this.registry
      .codeHost(Provider.parse(conn.provider))
      .listRepos({ externalId: conn.externalId });
    const repo = accessible.find((r) => r.repoPath === body.repoPath);
    if (!repo) throw repoPathProblem('repository is not accessible through this connection');
    let dto: ProjectDto;
    try {
      dto = await withOrg(this.db, org.orgId, async (tx) => {
        const [row] = await tx
          .insert(projects)
          .values({
            orgId: org.orgId,
            name: body.name ?? body.repoPath,
            repoPath: body.repoPath,
            defaultBranch: repo.defaultBranch,
            codeConnectionId: body.connectionId,
            boardConnectionId: body.connectionId,
            triggerMode: body.triggerMode,
            ...(body.pollIntervalSeconds === undefined ? {} : { pollIntervalSeconds: body.pollIntervalSeconds }),
            setupStep: 'agent',
            createdBy: org.userId,
          })
          .returning();
        if (!row) throw new Error('project insert returned no row');
        await tx.insert(agents).values({
          orgId: org.orgId,
          projectId: row.id,
          name: 'Claude',
          model: 'sonnet',
          maxTurns: 50,
          timeoutSeconds: 1800,
        });
        if (row.triggerMode === 'polling') {
          await tx.insert(pollCursors).values({ projectId: row.id, orgId: org.orgId, since: new Date() });
        }
        return this.dtoOf(tx, row);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('This repository is already a project');
      throw err;
    }
    await this.bestEffort('create schedule', () => this.schedules.sync(org.orgId, dto), dto.id);
    return dto;
  }

  async update(org: OrgContext, projectId: string, body: UpdateProjectRequest): Promise<ProjectDto> {
    const { before, dto } = await withOrg(this.db, org.orgId, async (tx) => {
      // FOR UPDATE: the forward-only setupStep check below must not race a concurrent PATCH.
      const before = await this.load(tx, projectId, true);
      const set: Partial<typeof projects.$inferInsert> = {};
      if (body.name !== undefined) set.name = body.name;
      if (body.triggerMode !== undefined) set.triggerMode = body.triggerMode;
      if (body.pollIntervalSeconds !== undefined) set.pollIntervalSeconds = body.pollIntervalSeconds;
      if (body.maxConcurrentRuns !== undefined) set.maxConcurrentRuns = body.maxConcurrentRuns;
      if (body.maxRunsPerTicket !== undefined) set.maxRunsPerTicket = body.maxRunsPerTicket;
      if (
        body.setupStep !== undefined &&
        STEP_ORDER.indexOf(body.setupStep) > STEP_ORDER.indexOf(SetupStep.parse(before.setupStep))
      ) {
        set.setupStep = body.setupStep;
      }
      const after =
        Object.keys(set).length === 0
          ? before
          : (await tx.update(projects).set(set).where(eq(projects.id, projectId)).returning())[0] ?? before;
      if (after.triggerMode === 'polling' && before.triggerMode !== 'polling') {
        // Switching to polling: the cursor starts at the switch time.
        await tx
          .insert(pollCursors)
          .values({ projectId, orgId: org.orgId, since: new Date() })
          .onConflictDoUpdate({
            target: pollCursors.projectId,
            set: { since: new Date(), etag: null, lastError: null, failures: 0, nextPollAt: null, pausedReason: null },
          });
      }
      return { before, dto: await this.dtoOf(tx, after) };
    });

    // Any explicit trigger setting re-syncs (idempotent), which also re-creates a missing schedule.
    if (body.triggerMode !== undefined || body.pollIntervalSeconds !== undefined) {
      await this.bestEffort(
        'sync schedule',
        () => this.schedules.sync(org.orgId, dto, { exists: before.triggerMode === 'polling' }),
        projectId,
      );
    }
    if (body.maxConcurrentRuns !== undefined) {
      await this.bestEffort(
        'set gate limit',
        () => this.schedules.setLimit(projectId, dto.maxConcurrentRuns),
        projectId,
      );
    }
    return dto;
  }

  /**
   * Refuses while any run is live (its workflow and Job would outlive the row). Otherwise deletes the project (runs,
   * agents and rules cascade), then best-effort removes what lives outside Postgres: the gate workflow, the poll
   * schedule and the agents' credential Secrets.
   */
  async remove(org: OrgContext, projectId: string): Promise<void> {
    const agentIds = await withOrg(this.db, org.orgId, async (tx) => {
      // FOR UPDATE: a run insert (FK share lock on this row) waits, so no run can appear between the check and delete.
      await this.load(tx, projectId, true);
      const [live] = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.projectId, projectId), inArray(runs.status, LIVE_STATUSES)))
        .limit(1);
      if (live) throw new ActiveRunsConflictException();
      const rows = await tx.select({ id: agents.id }).from(agents).where(eq(agents.projectId, projectId));
      await tx.delete(projects).where(eq(projects.id, projectId));
      return rows.map((r) => r.id);
    });
    await this.bestEffort('terminate gate', () => this.schedules.terminateGate(projectId), projectId);
    await this.bestEffort('delete schedule', () => this.schedules.remove(projectId), projectId);
    for (const agentId of agentIds) {
      // The Secret name is derived from (org, agent); a missing Secret is fine (delete is idempotent).
      await this.bestEffort(
        'delete credential secret',
        () => this.secrets.delete(credentialSecretName(org.orgId, agentId)),
        projectId,
      );
    }
  }

  async connection(org: OrgContext, projectId: string): Promise<ProjectConnectionDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      const row = await this.load(tx, projectId);
      const mode = TriggerMode.parse(row.triggerMode);
      if (mode === 'webhook') {
        const last = await tx
          .select({ at: inboundEvents.receivedAt, action: inboundEvents.action })
          .from(inboundEvents)
          .where(and(eq(inboundEvents.projectId, projectId), eq(inboundEvents.channel, 'webhook')))
          .orderBy(sql`${inboundEvents.receivedAt} desc`)
          .limit(1);
        return {
          mode,
          webhook: { lastEventAt: last[0]?.at.toISOString() ?? null, lastEventAction: last[0]?.action ?? null },
          polling: null,
        };
      }
      const cur = (await tx.select().from(pollCursors).where(eq(pollCursors.projectId, projectId)).limit(1))[0];
      return {
        mode,
        webhook: null,
        polling: {
          intervalSeconds: PollInterval.parse(row.pollIntervalSeconds),
          lastCheckedAt: cur?.lastPolledAt?.toISOString() ?? null,
          lastError: cur?.lastError ?? null,
          pausedReason: cur?.pausedReason ?? null,
          nextPollAt: cur?.nextPollAt?.toISOString() ?? null,
        },
      };
    });
  }
}
