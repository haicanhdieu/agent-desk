import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, withOrg, type Db, type Tx } from "../src";
import { startPg, type TestPg } from "./helpers/pg";
import { ORG_A, ORG_B, seedOrg, type SeededOrg } from "./helpers/seed";

let pgx: TestPg;
let db: Db;
let a: SeededOrg;
let b: SeededOrg;

beforeAll(async () => {
  pgx = await startPg();
  db = createDb(pgx.appUrl);
  a = await seedOrg(pgx.ownerUrl, ORG_A, {
    externalId: "acct-1",
    repoPath: "dev/demo",
  });
  b = await seedOrg(pgx.ownerUrl, ORG_B, {
    externalId: "acct-2",
    repoPath: "dev/other",
  });
});

afterAll(async () => {
  await db?.close();
  await pgx?.stop();
});

/** Inserts one row for `orgId` into a table, referencing the A-org rows for foreign keys. */
const inserts: Record<string, (tx: Tx, orgId: string) => Promise<unknown>> = {
  connections: (tx, o) =>
    tx.execute(sql`insert into connections (org_id, provider, capabilities, external_id, account_name)
      values (${o}, 'fake', '{"code":true,"board":true}', ${`x-${Math.random()}`}, 'acct')`),
  projects: (tx, o) =>
    tx.execute(sql`insert into projects (org_id, name, repo_path, code_connection_id, board_connection_id)
      values (${o}, 'p', ${`r/${Math.random()}`}, ${a.connectionId}, ${a.connectionId})`),
  agents: (tx, o) =>
    tx.execute(sql`insert into agents (org_id, project_id, name, model)
      values (${o}, ${a.projectId}, ${`n-${Math.random()}`}, 'm')`),
  rules: (tx, o) =>
    tx.execute(sql`insert into rules (org_id, project_id, command, agent_id, skill_name)
      values (${o}, ${a.projectId}, ${`/c${Math.random()}`}, ${a.agentId}, 's')`),
  runs: (tx, o) =>
    tx.execute(sql`insert into runs (org_id, project_id, command, skill_name, ticket_ref, ticket_kind, checkout_ref, trigger_source)
      values (${o}, ${a.projectId}, '/fix', 'fix', '#9', 'issue', 'main', 'manual')`),
  run_events: (tx, o) =>
    tx.execute(
      sql`insert into run_events (org_id, run_id, seq, type) values (${o}, ${a.runId}, 99, 'status')`,
    ),
  inbound_events: (tx, o) =>
    tx.execute(sql`insert into inbound_events (org_id, provider, channel, delivery_id, outcome)
      values (${o}, 'fake', 'webhook', ${`d-${Math.random()}`}, 'accepted')`),
  poll_cursors: (tx, o) =>
    tx.execute(
      sql`insert into poll_cursors (org_id, project_id) values (${o}, ${b.projectId})`,
    ),
  audit_log: (tx, o) =>
    tx.execute(sql`insert into audit_log (org_id, action) values (${o}, 'x')`),
};

function pgCode(e: unknown): unknown {
  let cur: unknown = e;
  while (typeof cur === "object" && cur !== null) {
    if ("code" in cur && typeof cur.code === "string") return cur.code;
    cur = "cause" in cur ? cur.cause : null;
  }
  return undefined;
}

describe.each(Object.keys(inserts))("RLS on %s", (table) => {
  it("withOrg(A) selects only org A rows", async () => {
    const rows = await withOrg(db, ORG_A, (tx) =>
      tx.execute<{ org_id: string }>(
        sql`select org_id from ${sql.identifier(table)}`,
      ),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(new Set(rows.rows.map((r) => r.org_id))).toEqual(new Set([ORG_A]));
  });

  it("withOrg(A) cannot insert a row for org B (42501)", async () => {
    const insert = inserts[table];
    if (!insert) throw new Error("no insert");
    const err = await withOrg(db, ORG_A, (tx) => insert(tx, ORG_B)).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(err)).toBe("42501");
  });

  it("a raw query without withOrg returns 0 rows", async () => {
    const r = await db.pool.query(`select 1 from ${table}`);
    expect(r.rowCount).toBe(0);
  });
});

describe("inbound_events null-org intake", () => {
  it("allows an insert without an org (no RETURNING) that stays invisible to every tenant", async () => {
    await withOrg(db, ORG_A, (tx) =>
      tx.execute(sql`insert into inbound_events (org_id, provider, channel, delivery_id, outcome)
        values (null, 'fake', 'webhook', 'orphan-1', 'unmatched')`),
    );
    for (const org of [ORG_A, ORG_B]) {
      const r = await withOrg(db, org, (tx) =>
        tx.execute(
          sql`select 1 from inbound_events where delivery_id = 'orphan-1'`,
        ),
      );
      expect(r.rows).toHaveLength(0);
    }
    const r = await db.pool.query(`select 1 from inbound_events`);
    expect(r.rowCount).toBe(0);
  });

  it("rejects RETURNING on a null-org insert", async () => {
    const err = await withOrg(db, ORG_A, (tx) =>
      tx.execute(sql`insert into inbound_events (org_id, provider, channel, delivery_id, outcome)
        values (null, 'fake', 'webhook', 'orphan-2', 'unmatched') returning id`),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(pgCode(err)).toBe("42501");
  });
});

describe("withOrg", () => {
  it("does not leak the org to the next transaction on a reused connection", async () => {
    await withOrg(db, ORG_A, (tx) => tx.execute(sql`select 1`));
    const r = await db.pool.query(
      `select current_setting('app.org_id', true) as v`,
    );
    expect(r.rows[0]?.v ?? "").toBe("");
  });

  it("rejects a non-uuid org id before querying", async () => {
    await expect(
      withOrg(db, `x'; drop table runs; --`, async () => 1),
    ).rejects.toThrow(/org id/i);
  });
});
