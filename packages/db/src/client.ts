import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

/** Handle to the app-role pool. Tenant data is reachable only through `withOrg`; `pool` is for
 * non-tenant statements (the cross-tenant functions) and shutdown. */
export interface Db {
  readonly pool: pg.Pool;
  readonly orm: NodePgDatabase;
  close(): Promise<void>;
}

export function createDb(appUrl: string): Db {
  const pool = new pg.Pool({ connectionString: appUrl });
  // An idle client erroring (e.g. server restart) must not crash the process; the pool drops it.
  pool.on("error", () => undefined);
  return { pool, orm: drizzle(pool), close: () => pool.end() };
}
