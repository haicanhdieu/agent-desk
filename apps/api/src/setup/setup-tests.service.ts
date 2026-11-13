import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WorkflowNotFoundError, type Client } from '@temporalio/client';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { projects, setupTests, user, withOrg, type Db, type Tx } from '@agentdesk/db';
import { SIGNAL, TASK_QUEUE, WORKFLOW, setupTestWorkflowId } from '@agentdesk/core';
import { SetupTestDto, type CreateSetupTestRequest } from '@agentdesk/contracts';
import type { OrgContext } from '../auth/org-context';
import { CONFIG, type Config } from '../config/config.module';
import { DB } from '../db/db.module';
import { assertCanEditProject, assertProjectVisible } from '../projects/project-access';
import { TEMPORAL_CLIENT } from '../temporal/temporal-client.module';
import { SetupScriptService } from './setup-script.service';

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The columns of a setup test that the DTO is built from. `script_body` is deliberately not among them. */
export const setupTestColumns = {
  id: setupTests.id,
  projectId: setupTests.projectId,
  status: setupTests.status,
  scriptSha256: setupTests.scriptSha256,
  checkoutSha: setupTests.checkoutSha,
  plugins: setupTests.plugins,
  exitCode: setupTests.exitCode,
  startedBy: sql<string>`coalesce(${user.handle}, ${setupTests.startedBy})`,
  createdAt: setupTests.createdAt,
  finishedAt: setupTests.finishedAt,
  endedAt: setupTests.endedAt,
};

export interface SetupTestRow {
  id: string;
  projectId: string;
  status: string;
  scriptSha256: string;
  checkoutSha: string | null;
  plugins: { installed: unknown[]; skipped: unknown[]; failed: unknown[] };
  exitCode: number | null;
  startedBy: string;
  createdAt: Date;
  finishedAt: Date | null;
  endedAt: Date | null;
}

/** Plugin entries are names; an entry that is an object with a `name` is reduced to it, anything else is dropped. */
function pluginNames(list: unknown[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    if (typeof item === 'string') out.push(item);
    else if (typeof item === 'object' && item !== null && 'name' in item && typeof item.name === 'string') {
      out.push(item.name);
    }
  }
  return out;
}

/** `currentScript` is the project's newest saved script body (null when none was saved, which counts as empty). */
export function toSetupTestDto(row: SetupTestRow, currentScript: string | null, ttlSeconds: number): SetupTestDto {
  const endsAt =
    row.endedAt === null && row.finishedAt !== null
      ? new Date(row.finishedAt.getTime() + ttlSeconds * 1000).toISOString()
      : null;
  return SetupTestDto.parse({
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    scriptSha256: row.scriptSha256,
    matchesCurrentScript: row.scriptSha256 === sha256Hex(currentScript ?? ''),
    checkoutSha: row.checkoutSha,
    plugins: {
      installed: pluginNames(row.plugins.installed),
      skipped: pluginNames(row.plugins.skipped),
      failed: pluginNames(row.plugins.failed),
    },
    exitCode: row.exitCode,
    startedBy: row.startedBy,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    endsAt,
  });
}

const errorName = (err: unknown): string => (err instanceof Error ? err.name : 'unknown');

@Injectable()
export class SetupTestsService {
  private readonly log = new Logger(SetupTestsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
    @Inject(SetupScriptService) private readonly scripts: SetupScriptService,
  ) {}

  /**
   * Inserts the test and, after commit, ends the project's earlier active tests and starts the new workflow.
   * The project row lock serialises concurrent creates, so each one sees every earlier test as "previous"; the signalled
   * workflow finalizes its own row (`ended_at`), the API never writes it. The script text goes only into the row:
   * workflow arguments carry ids.
   */
  async create(org: OrgContext, projectId: string, req: CreateSetupTestRequest): Promise<SetupTestDto> {
    const { dto, previous } = await withOrg(this.db, org.orgId, async (tx) => {
      await assertCanEditProject(tx, org, projectId);
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
      const prev = await tx
        .select({ id: setupTests.id })
        .from(setupTests)
        .where(and(eq(setupTests.projectId, projectId), isNull(setupTests.endedAt)));
      const inserted = await tx
        .insert(setupTests)
        .values({
          orgId: org.orgId,
          projectId,
          status: 'queued',
          scriptSha256: sha256Hex(req.script),
          scriptBody: req.script,
          startedBy: org.userId,
          // Taken after the project lock, so created_at order is commit order (now() would be the transaction start).
          createdAt: sql`clock_timestamp()`,
        })
        .returning({ id: setupTests.id });
      const id = inserted[0]?.id;
      if (!id) throw new Error('setup test insert returned no row');
      const rows = await tx
        .select(setupTestColumns)
        .from(setupTests)
        .leftJoin(user, eq(user.id, setupTests.startedBy))
        .where(eq(setupTests.id, id))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('setup test vanished after insert');
      const current = (await this.scripts.current(tx, projectId))?.body ?? null;
      return {
        dto: toSetupTestDto(row, current, this.config.SETUP_TEST_TTL_SECONDS),
        previous: prev.map((p) => p.id),
      };
    });

    for (const id of previous) {
      try {
        await this.temporal.workflow.getHandle(setupTestWorkflowId(id)).signal(SIGNAL.endSetupTest);
      } catch (err) {
        // Best effort: the previous workflow may already be gone. Name only, never the message or arguments.
        this.log.warn(`could not end previous setup test: ${errorName(err)}`);
      }
    }
    try {
      await this.temporal.workflow.start(WORKFLOW.setupTest, {
        taskQueue: TASK_QUEUE,
        workflowId: setupTestWorkflowId(dto.id),
        args: [{ orgId: org.orgId, setupTestId: dto.id }],
      });
    } catch (err) {
      // No workflow will ever finalize this row: close it so it is not left "active", and drop the script text.
      await withOrg(this.db, org.orgId, (tx) =>
        tx
          .update(setupTests)
          .set({ status: 'ended', endedAt: new Date(), scriptBody: null })
          .where(eq(setupTests.id, dto.id)),
      ).catch(() => undefined);
      this.log.error(`could not start setup test workflow: ${errorName(err)}`);
      throw err;
    }
    return dto;
  }

  async latest(org: OrgContext, projectId: string): Promise<SetupTestDto | null> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const rows = await tx
        .select(setupTestColumns)
        .from(setupTests)
        .leftJoin(user, eq(user.id, setupTests.startedBy))
        .where(eq(setupTests.projectId, projectId))
        .orderBy(desc(setupTests.createdAt), desc(setupTests.id))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      const current = (await this.scripts.current(tx, projectId))?.body ?? null;
      return toSetupTestDto(row, current, this.config.SETUP_TEST_TTL_SECONDS);
    });
  }

  /** Asks the test's workflow to end now (the workflow deletes the workspace and sets `ended_at`). */
  async end(org: OrgContext, setupTestId: string): Promise<void> {
    await withOrg(this.db, org.orgId, async (tx: Tx) => {
      const rows = await tx
        .select({ projectId: setupTests.projectId })
        .from(setupTests)
        .where(eq(setupTests.id, setupTestId))
        .limit(1);
      const test = rows[0];
      if (!test) throw new NotFoundException('Setup test not found');
      await assertCanEditProject(tx, org, test.projectId);
    });
    try {
      await this.temporal.workflow.getHandle(setupTestWorkflowId(setupTestId)).signal(SIGNAL.endSetupTest);
    } catch (err) {
      // Already finished: ending it again is a no-op.
      if (!(err instanceof WorkflowNotFoundError)) throw err;
    }
  }
}
