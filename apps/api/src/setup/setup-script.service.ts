import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { projects, setupScriptVersions, user, withOrg, type Db, type Tx } from '@agentdesk/db';
import type { PutSetupScriptRequest, SetupScriptDto, SetupScriptVersionDto } from '@agentdesk/contracts';
import type { OrgContext } from '../auth/org-context';
import { DB } from '../db/db.module';
import { assertCanEditProject, assertProjectVisible } from '../projects/project-access';

const versionColumns = {
  version: setupScriptVersions.version,
  note: setupScriptVersions.note,
  createdBy: sql<string>`coalesce(${user.handle}, ${setupScriptVersions.createdBy})`,
  createdAt: setupScriptVersions.createdAt,
};

interface VersionRow {
  version: number;
  note: string | null;
  createdBy: string;
  createdAt: Date;
}

function toVersionDto(row: VersionRow): SetupScriptVersionDto {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

@Injectable()
export class SetupScriptService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The newest version of the project's script, or null when none was ever saved. Caller has already checked access. */
  async current(tx: Tx, projectId: string): Promise<{ version: number; body: string } | null> {
    const rows = await tx
      .select({ version: setupScriptVersions.version, body: setupScriptVersions.body })
      .from(setupScriptVersions)
      .where(eq(setupScriptVersions.projectId, projectId))
      .orderBy(desc(setupScriptVersions.version))
      .limit(1);
    return rows[0] ?? null;
  }

  async get(org: OrgContext, projectId: string): Promise<SetupScriptDto | null> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const rows = await tx
        .select({ ...versionColumns, body: setupScriptVersions.body })
        .from(setupScriptVersions)
        .leftJoin(user, eq(user.id, setupScriptVersions.createdBy))
        .where(eq(setupScriptVersions.projectId, projectId))
        .orderBy(desc(setupScriptVersions.version))
        .limit(1);
      const row = rows[0];
      return row ? { ...toVersionDto(row), body: row.body } : null;
    });
  }

  async versions(org: OrgContext, projectId: string): Promise<SetupScriptVersionDto[]> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const rows = await tx
        .select(versionColumns)
        .from(setupScriptVersions)
        .leftJoin(user, eq(user.id, setupScriptVersions.createdBy))
        .where(eq(setupScriptVersions.projectId, projectId))
        .orderBy(desc(setupScriptVersions.version));
      return rows.map(toVersionDto);
    });
  }

  async version(org: OrgContext, projectId: string, version: number): Promise<SetupScriptDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertProjectVisible(tx, projectId);
      const rows = await tx
        .select({ ...versionColumns, body: setupScriptVersions.body })
        .from(setupScriptVersions)
        .leftJoin(user, eq(user.id, setupScriptVersions.createdBy))
        .where(and(eq(setupScriptVersions.projectId, projectId), eq(setupScriptVersions.version, version)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundException('Setup script version not found');
      return { ...toVersionDto(row), body: row.body };
    });
  }

  /**
   * Appends version max+1 when `baseVersion` is the current max (null = none yet), else 409.
   * The project row lock serialises concurrent writers so the compare-and-insert is atomic.
   */
  async put(org: OrgContext, projectId: string, req: PutSetupScriptRequest): Promise<SetupScriptDto> {
    return withOrg(this.db, org.orgId, async (tx) => {
      await assertCanEditProject(tx, org, projectId);
      await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
      const maxRows = await tx
        .select({ max: sql<number | null>`max(${setupScriptVersions.version})` })
        .from(setupScriptVersions)
        .where(eq(setupScriptVersions.projectId, projectId));
      const max = maxRows[0]?.max ?? null;
      if (max !== req.baseVersion) throw new ConflictException('Setup script changed since it was loaded');
      const inserted = await tx
        .insert(setupScriptVersions)
        .values({
          orgId: org.orgId,
          projectId,
          version: (max ?? 0) + 1,
          body: req.body,
          note: req.note ?? null,
          createdBy: org.userId,
        })
        .returning({
          version: setupScriptVersions.version,
          body: setupScriptVersions.body,
          note: setupScriptVersions.note,
          createdAt: setupScriptVersions.createdAt,
        });
      const row = inserted[0];
      if (!row) throw new Error('setup script insert returned no row');
      const handle = await tx.select({ handle: user.handle }).from(user).where(eq(user.id, org.userId)).limit(1);
      return {
        version: row.version,
        body: row.body,
        note: row.note,
        createdBy: handle[0]?.handle ?? org.userId,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}
