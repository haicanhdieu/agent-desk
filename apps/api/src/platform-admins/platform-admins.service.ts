import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { platformAdmins, user, type Db, type Tx } from '@agentdesk/db';
import { pageWindow, toPage, type Page, type PageQuery, type PlatformAdminDto } from '@agentdesk/contracts';
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
  granterName: string | null;
  granterHandle: string | null;
  granterId: string | null;
};

function toDto(r: Row): PlatformAdminDto {
  return {
    id: r.id,
    email: r.email,
    userId: r.userId,
    name: r.name,
    handle: r.handle,
    grantedAt: r.grantedAt.toISOString(),
    grantedBy: r.granterId === null ? null : toInviterDto({ name: r.granterName ?? '', handle: r.granterHandle }),
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
  return row === undefined ? undefined : toDto(row);
}

@Injectable()
export class PlatformAdminsService {
  constructor(@Inject(DB) private readonly db: Db) {}

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
    return toPage(rows.map(toDto), counted?.total ?? 0, q);
  }
}
