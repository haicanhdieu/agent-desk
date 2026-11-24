import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { platformAdmins, user, type Db, type Tx } from '@agentdesk/db';
import {
  pageWindow,
  toPage,
  type GrantPlatformAdminRequest,
  type Page,
  type PageQuery,
  type PlatformAdminDto,
} from '@agentdesk/contracts';
import type { Logger } from 'pino';
import { writePlatformAuditEntry } from '../audit/platform-audit-entry';
import { LOGGER } from '../common/logger';
import { requestContext } from '../common/request-context';
import { NotFoundProblemException, UnprocessableProblemException } from '../common/zod-validation';
import { DB } from '../db/db.module';
import { toInviterDto } from '../invitations/inviter';

const account = alias(user, 'account');
const granter = alias(user, 'granter');

const columns = {
  id: platformAdmins.id,
  email: platformAdmins.email,
  grantedAt: platformAdmins.grantedAt,
  userId: account.id,
  name: account.name,
  handle: account.handle,
  verified: account.emailVerified,
  granterName: granter.name,
  granterHandle: granter.handle,
  granterId: granter.id,
};

type Row = {
  id: string;
  email: string;
  grantedAt: Date;
  userId: string | null;
  name: string | null;
  handle: string | null;
  verified: boolean | null;
  granterName: string | null;
  granterHandle: string | null;
  granterId: string | null;
};

/** Entries backed by a verified account: the ones that can sign in as a platform admin. */
async function countWorking(tx: Db['orm'] | Tx): Promise<number> {
  const [working] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(platformAdmins)
    .innerJoin(user, and(sql`lower(${user.email}) = ${platformAdmins.email}`, eq(user.emailVerified, true)));
  return working?.n ?? 0;
}

function toDto(r: Row, workingCount: number): PlatformAdminDto {
  return {
    id: r.id,
    email: r.email,
    userId: r.userId,
    name: r.name,
    handle: r.handle,
    grantedAt: r.grantedAt.toISOString(),
    grantedBy: r.granterId === null ? null : toInviterDto({ name: r.granterName ?? '', handle: r.granterHandle }),
    lastWorkingAdmin: r.verified === true && workingCount === 1,
  };
}

/** One entry by id, read with the same two left joins as the list; undefined when it does not exist. */
export async function findPlatformAdmin(tx: Db['orm'] | Tx, id: string): Promise<PlatformAdminDto | undefined> {
  const rows = await tx
    .select(columns)
    .from(platformAdmins)
    .leftJoin(account, sql`lower(${account.email}) = ${platformAdmins.email}`)
    .leftJoin(granter, eq(granter.id, platformAdmins.grantedBy))
    .where(eq(platformAdmins.id, id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? undefined : toDto(row, await countWorking(tx));
}

/** Reads the entry inside the grant transaction, so a concurrent revoke cannot remove it before the answer. */
async function readEntry(tx: Tx, id: string): Promise<PlatformAdminDto> {
  const entry = await findPlatformAdmin(tx, id);
  if (entry === undefined) throw new Error('platform admin entry vanished inside the grant transaction');
  return entry;
}

@Injectable()
export class PlatformAdminsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Grants the role to `req.email` (an existing verified account). One transaction under the table's advisory lock:
   * re-read, insert, audit row. A repeat answers the existing entry with `created: false` and writes nothing.
   */
  async grant(
    actorUserId: string,
    req: GrantPlatformAdminRequest,
  ): Promise<{ entry: PlatformAdminDto; created: boolean }> {
    const result = await this.db.orm.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_admins'))`);
      const found = await tx
        .select({ id: user.id, emailVerified: user.emailVerified })
        .from(user)
        .where(sql`lower(${user.email}) = ${req.email}`)
        .limit(1);
      const account = found[0];
      if (account === undefined) {
        throw new NotFoundProblemException('User not found', [
          { pointer: '/email', detail: 'no account has this email' },
        ]);
      }
      if (!account.emailVerified) {
        throw new UnprocessableProblemException('Email not verified', [
          { pointer: '/email', detail: 'this account has no verified email' },
        ]);
      }
      const existing = await tx
        .select({ id: platformAdmins.id })
        .from(platformAdmins)
        .where(eq(platformAdmins.email, req.email))
        .limit(1);
      const existingId = existing[0]?.id;
      if (existingId !== undefined) {
        return { id: existingId, created: false, userId: account.id, entry: await readEntry(tx, existingId) };
      }
      const inserted = await tx
        .insert(platformAdmins)
        .values({ email: req.email, grantedBy: actorUserId })
        .returning({ id: platformAdmins.id });
      const id = inserted[0]?.id;
      if (id === undefined) throw new Error('platform admin insert returned no row');
      await writePlatformAuditEntry(tx, {
        actorUserId,
        action: 'platform_admin.granted',
        targetType: 'platform_admin',
        targetId: id,
        payload: { email: req.email, userId: account.id },
      });
      return { id, created: true, userId: account.id, entry: await readEntry(tx, id) };
    });
    if (result.created) {
      this.logger.info(
        { requestId: requestContext.get()?.requestId, actorUserId, adminId: result.id, targetUserId: result.userId },
        'platform admin granted',
      );
    }
    return { entry: result.entry, created: result.created };
  }

  /**
   * Removes entry `adminId`. One transaction under the table's advisory lock: re-read, count the working entries
   * (a verified account with the entry's email) other than the target, refuse with 409 when none would remain,
   * delete, audit row. A 4xx writes nothing.
   */
  async revoke(actorUserId: string, adminId: string): Promise<void> {
    const result = await this.db.orm.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_admins'))`);
      const found = await tx
        .select({ id: platformAdmins.id, email: platformAdmins.email })
        .from(platformAdmins)
        .where(eq(platformAdmins.id, adminId))
        .limit(1);
      const entry = found[0];
      if (entry === undefined) throw new NotFoundException('Platform admin not found');
      const [working] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(platformAdmins)
        .innerJoin(user, and(sql`lower(${user.email}) = ${platformAdmins.email}`, eq(user.emailVerified, true)))
        .where(ne(platformAdmins.id, adminId));
      if ((working?.n ?? 0) === 0) throw new ConflictException('Cannot revoke the last platform admin');
      const accounts = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${entry.email}`)
        .limit(1);
      const userId = accounts[0]?.id ?? null;
      await tx.delete(platformAdmins).where(eq(platformAdmins.id, adminId));
      await writePlatformAuditEntry(tx, {
        actorUserId,
        action: 'platform_admin.revoked',
        targetType: 'platform_admin',
        targetId: adminId,
        payload: { email: entry.email, userId },
      });
      return { userId };
    });
    this.logger.info(
      { requestId: requestContext.get()?.requestId, actorUserId, adminId, targetUserId: result.userId },
      'platform admin revoked',
    );
  }

  /** Every entry, newest grant first (ties by id). Platform-wide by design: no tenant data is touched. */
  async list(q: PageQuery): Promise<Page<PlatformAdminDto>> {
    const { limit, offset } = pageWindow(q);
    const orm = this.db.orm;
    const [counted] = await orm.select({ total: sql<number>`count(*)::int` }).from(platformAdmins);
    const rows = await orm
      .select(columns)
      .from(platformAdmins)
      .leftJoin(account, sql`lower(${account.email}) = ${platformAdmins.email}`)
      .leftJoin(granter, eq(granter.id, platformAdmins.grantedBy))
      .orderBy(desc(platformAdmins.grantedAt), asc(platformAdmins.id))
      .limit(limit)
      .offset(offset);
    const workingCount = await countWorking(orm);
    return toPage(
      rows.map((r) => toDto(r, workingCount)),
      counted?.total ?? 0,
      q,
    );
  }
}
