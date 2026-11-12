import { sql } from "drizzle-orm";
import type { Db } from "./client";

type OrmTx = Parameters<Parameters<Db["orm"]["transaction"]>[0]>[0];

/** Transaction handle scoped to one org by `withOrg`. */
export type Tx = OrmTx;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Runs `fn` in a transaction with `app.org_id` set transaction-locally, so RLS scopes every query. */
export async function withOrg<T>(
  db: Db,
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(orgId)) throw new Error("withOrg: org id must be a uuid");
  return db.orm.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
