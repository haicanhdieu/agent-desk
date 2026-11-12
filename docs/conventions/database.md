# Database guidelines

How we design, change and query the Postgres application database so that tenants stay isolated, migrations are safe to run on a live system, and run state has one writer.
Stack: Postgres 18, Drizzle ORM + drizzle-kit (schema in TypeScript, generated SQL migrations), `pg` driver, row-level security keyed by `app.org_id`.

**Applies to:** `packages/db` (schema, migrations, `withOrg`, functions), and every query in `apps/api`, `apps/worker` and `packages/core`.
Siblings: [architecture.md](architecture.md) · [backend.md](backend.md) · [typescript.md](typescript.md) · [security.md](security.md) · [testing.md](testing.md) · [git-workflow.md](git-workflow.md) · [code-review-checklist.md](code-review-checklist.md)

Temporal keeps its own databases (`temporal`, `temporal_visibility`); nothing in this doc applies to them and app code **MUST NOT** query them.

## 1. Roles and connections

| Role              | Used by                                            | Rights                                              |
| ----------------- | -------------------------------------------------- | --------------------------------------------------- |
| server admin      | `bootstrapDatabase` in the migrate entrypoint only | Creates roles and databases idempotently            |
| `agentdesk_owner` | `runMigrations`                                    | Owns tables, policies, `SECURITY DEFINER` functions |
| `agentdesk_app`   | api and worker at runtime                          | DML only; no `BYPASSRLS`, not owner                 |

- **MUST** connect the api and worker as `agentdesk_app` (`DATABASE_APP_URL`). **MUST NOT** use the owner or admin URL at runtime. _Why: RLS is not enforced for owners without FORCE, and never for `BYPASSRLS`._
- **MUST** run migrations only through `pnpm db:migrate` (`apps/api` `migrate` entrypoint), never by hand against a shared environment.

## 2. Tenancy: every query is org-scoped

- Every application table **MUST** have `org_id uuid not null`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and the policy `org_id = current_setting('app.org_id')::uuid` declared with Drizzle `pgPolicy`. Sole exception: `inbound_events.org_id` is nullable until the project is resolved. better-auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) are owned by better-auth and have no `org_id`.
- **MUST** obtain a handle only through `withOrg(db, orgId, tx => …)` (in the api: `OrgDb.run`). _Why: it opens the transaction and sets `app.org_id` locally; without it RLS returns zero rows._
- **MUST NOT** pass `db` (the pool) into repositories or services; pass `tx: Tx`.
- **MUST** still write `org_id` on inserts and **SHOULD** filter by `project_id` explicitly; RLS is the backstop, not the only filter. _Why: defence in depth, and the planner uses the index._
- Cross-tenant reads are limited to two `SECURITY DEFINER` functions: `resolve_project(provider, external_id, repo_path)` and `queued_runs_without_workflow(older_than)`. A new one **MUST** be reviewed against [security.md](security.md), `SET search_path` explicitly, return only ids, and get an RLS test.
- **MUST** ship a leak test for every new org table: org A cannot read, update or insert B's rows, and a query without `withOrg` sees nothing (`packages/db/test/rls.test.ts`).

```ts
// bad: pool query, no tenant context; returns 0 rows under RLS, or all rows if RLS is ever off
await db.select().from(runs).where(eq(runs.id, runId));

// good
await withOrg(db, orgId, (tx) =>
  tx
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, projectId), eq(runs.id, runId))),
);
```

## 3. Naming

- Tables: snake_case, plural (`runs`, `run_events`, `poll_cursors`). better-auth's singular tables are the exception; don't rename them.
- Columns: snake_case in SQL, camelCase in the Drizzle TS object (`queuedAt: timestamp('queued_at', …)`).
- **MUST NOT** use provider names in tables, columns, enum types, functions or indexes (`github_user_id`, `webhook_deliveries` for GitHub, `installation_id`). Use generic concepts: `connections.external_id`, `provider`, `config jsonb`. _Why: owner rule; GitLab, Bitbucket, Jira later._
- Primary keys: `id uuid` default `gen_random_uuid()`. Child tables keyed by parent + sequence use a composite PK (`run_events (run_id, seq)`). User-facing numbers (`runs.number`) are separate from ids.
- Foreign keys: `<referenced_singular>_id` (`project_id`, `agent_id`, `code_connection_id`).
- Timestamps: `timestamptz`, named `<event>_at` (`created_at`, `queued_at`, `finished_at`, `last_polled_at`). **MUST NOT** use `timestamp` without time zone. New columns **MUST NOT** use bare `ts`/`at` (see inconsistencies in the spec, to fix before the first migration).
- Durations: integer with unit suffix (`timeout_seconds`, `poll_interval_seconds`).
- Booleans: positive adjective (`enabled`), not `is_disabled`.
- Status-like columns: `text` + `CHECK (status in (...))` matching the contracts enum, not Postgres `enum` types. _Why: adding a value to a pg enum is awkward in a transaction and needs a separate migration._
- Constraints and indexes: `<table>_<cols>_key` (unique), `<table>_<cols>_idx`, `<table>_<col>_fkey`, `<table>_<rule>_check`.

```ts
// good: generic names, tenant column, policy, FK index, unique idempotency key
export const rules = pgTable(
  'rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    command: text('command').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('rules_project_id_command_key').on(t.projectId, t.command),
    index('rules_project_id_idx').on(t.projectId),
    pgPolicy('rules_org_isolation', {
      using: sql`org_id = current_setting('app.org_id')::uuid`,
      withCheck: sql`org_id = current_setting('app.org_id')::uuid`,
    }),
  ],
);
// bad: table 'github_rules', column 'installation_id', timestamp without time zone
```

## 4. Indexes and keys

- **MUST** index every foreign key column, leading with it, unless a composite index already starts with it. _Why: Postgres doesn't do it for you; deletes and joins scan otherwise._
- **MUST** back every idempotency rule with a unique constraint, not an application check: `inbound_events (provider, delivery_id)`, `runs (project_id, trigger_comment_id)`, `runs (project_id, number)`, `rules (project_id, command)`, `connections (provider, external_id)`. _Why: two replicas race; only the database is atomic._
- **SHOULD** match list queries with a composite index in the same column order as the keyset cursor (e.g. `runs (project_id, queued_at desc, id)`).
- **SHOULD** use partial indexes for hot filtered sets (`runs (project_id) where status in ('starting','running','idle')`).

## 4a. Deletes and retention

- **MUST** declare `ON DELETE` explicitly on every FK. Children owned by a parent (`rules`, `agents`, `poll_cursors` → `projects`; `run_events` → `runs`) cascade; history that must outlive its parent (`runs.rule_id` when a rule is deleted) uses `SET NULL`. _Why: the default `NO ACTION` turns a project delete into a 500._
- **MUST NOT** add soft-delete flags (`deleted_at`) without a spec decision; they leak into every query and RLS policy.
- `audit_log` and `inbound_events` are append-only from app code: no `UPDATE`/`DELETE` except the intake's outcome update on its own row. Retention jobs (planned) run as Temporal Schedules, batched.
- Deleting a project **MUST** also remove its Temporal Schedule and gate (done in the service, outside the DB transaction, see §6).

## 5. Migrations

Workflow: edit `packages/db/src/schema/*.ts` → `drizzle-kit generate` → review the SQL → commit both. RLS `FORCE`, grants and `SECURITY DEFINER` functions go in hand-written SQL migrations.

- **MUST** be forward-only. No down migrations; fix forward with a new migration. _Why: down scripts are untested and lose data._
- **MUST NOT** edit, rename, reorder or delete a migration once merged to `main`. _Why: environments that applied it diverge silently from the journal._
- **MUST** read the generated SQL before committing. drizzle-kit may emit a drop + add for a rename; rewrite as `ALTER … RENAME`.
- **MUST** keep each migration safe to run while the previous app version is live (expand → migrate → contract):

| Change                     | Safe pattern                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Add column                 | Nullable, or `NOT NULL DEFAULT <constant>`; never a volatile default on a big table                   |
| Make column `NOT NULL`     | Add `CHECK (col is not null) NOT VALID` → `VALIDATE CONSTRAINT` → `SET NOT NULL` in a later migration |
| Rename column/table        | Add new → dual-write → backfill → switch reads → drop old in a later release                          |
| Drop column                | Stop reading/writing it in one release, drop in the next                                              |
| Add index on a large table | `CREATE INDEX CONCURRENTLY` in its own migration (no transaction)                                     |
| Add FK                     | `NOT VALID`, then `VALIDATE CONSTRAINT` separately                                                    |
| Add status value           | Update the `CHECK` and the contracts enum in the same PR; ship readers before writers                 |

- **MUST** put data backfills in a separate migration (or a one-off script under `scripts/`) from schema changes, batched, and idempotent (`where new_col is null`). _Why: long transactions lock tables and can't be retried._
- **MUST** include an RLS policy, `FORCE`, grants to `agentdesk_app`, and FK indexes in the same migration that creates an org table.
- **MUST** pass `packages/db/test/migrate.test.ts` (fresh DB, migrate twice, invariants) before merge. CI gate (planned).
- **SHOULD** keep migrations small and single-purpose; name them for what they do (`0007_runs_add_idle_since.sql`) by passing `--name` to drizzle-kit.

## 6. Transactions

- **MUST** change related rows in one transaction: run insert + `inbound_events` outcome; `setRunStatus` (update `runs`, append `run_events`, `pg_notify`); project create + default `agents` row + `poll_cursors` row. _Why: partial writes leave the UI and workflows disagreeing._
- `withOrg` _is_ the transaction. **MUST NOT** nest another `withOrg` inside one, or open a second connection inside it.
- **MUST NOT** call external services (provider API, Kubernetes, Temporal, SecretStore) inside a DB transaction. Do the call, then record the result in a short transaction keyed for idempotency. _Why: holds locks and connections for network latency; rollbacks can't undo a comment._
- `pg_notify` **MUST** be issued inside the transaction that made the change (it fires on commit), never after.
- **SHOULD** rely on unique constraints and catch `23505` for "already exists" rather than read-then-insert.

```ts
// good: idempotent insert, one transaction
try {
  await withOrg(db, orgId, (tx) => tx.insert(runs).values(newRun));
} catch (err) {
  if (isUniqueViolation(err, 'runs_project_id_trigger_comment_id_key')) return { outcome: 'duplicate_comment' };
  throw err;
}
```

## 7. Run state: one writer

- After the initial `queued` insert by intake, `runs.status` **MUST** change only through the `setRunStatus` activity (`apps/worker/src/activities/run-status.activity.ts`). API cancel/finish **signal** the workflow; they don't write status. _Why: Temporal holds execution state; `runs` is its read model, and two writers race._
- `setRunStatus` in one transaction: update `status` and the matching timestamp (`started_at` on `running`, `finished_at` on a final status, `idle_since` set on `idle` and cleared otherwise), append `run_events { type: 'status' }` with the next `seq`, `pg_notify('run_status', { orgId, runId, seq })`.
- Transitions **MUST** follow `queued → starting → running ⇄ idle → succeeded | failed | cancelled | timed_out`. A write out of a final status (`FINAL_RUN_STATUSES`) is a no-op, not an error. **MUST NOT** move `idle` back to `running` from a replayed log line.
- **SHOULD** guard the update in SQL so concurrent calls can't regress state: `UPDATE runs SET … WHERE id = $1 AND status NOT IN (<final>)`.

## 8. Queries and N+1

- **MUST NOT** query inside a loop over rows (`for (const run of runs) await getAgent(run.agentId)`). Join, or load with `inArray` and map in memory. _Why: list pages turn into 50+ round trips._
- **SHOULD** compute counts/aggregates in one grouped query (project `counts`, rule `stats`) rather than per row.
- **MUST** paginate lists with keyset cursors and a bounded `limit` (≤ 100). **MUST NOT** use `OFFSET` on growing tables.
- **MUST** select only needed columns on hot paths and never return internal columns (`credential_secret_name`, `workflow_id`, `outbox`) through DTOs.
- **MUST** use Drizzle's query builder or `sql` template with bound parameters. **MUST NOT** build SQL by string concatenation. _Why: injection._
- `jsonb` columns (`outbox`, `payload`, `config`, `ticket_labels`) **MUST** have a Zod schema and be parsed on read (see [typescript.md](typescript.md) §3).
- **MUST NOT** store secrets (credential values, workspace tokens) in any column; store a reference (`credential_secret_name`) and metadata only.

## 9. Seeding and local database

- Local Postgres runs from `docker-compose.yml` (`postgres:18`, host port `54329`), started by `devbox run dev`. Migrate, psql, reset and add-a-migration steps are in the runbook [database-local.md](../runbooks/database-local.md).
- **MUST NOT** add reset or seed commands that can target a non-local URL.
- Seed data for local use comes from the dev flows (`/auth/dev-login`, fake provider install, `/dev/fake/*`), not SQL dumps. A seed script, if added, lives in `scripts/`, is idempotent, refuses to run when `NODE_ENV=production`, and goes through `withOrg`.
- Tests use Testcontainers Postgres via `startPg()` with the real migrations and the `agentdesk_app` role; **MUST NOT** test against the shared dev DB or mock Drizzle. See [testing.md](testing.md).

## Checklist

- [ ] New org table: `org_id not null`, RLS enabled + forced, policy, grants, FK indexes, leak test.
- [ ] Every query runs inside `withOrg`; no pool handle in services or repositories.
- [ ] Names are snake_case, plural tables, `*_at timestamptz`, unit-suffixed durations, no provider names.
- [ ] Idempotency rules are unique constraints, and `23505` is handled by constraint name.
- [ ] Migration is new (no edits to merged ones), SQL reviewed, safe against the live previous version, backfill separate.
- [ ] Multi-row state changes are in one transaction; no network calls inside it; NOTIFY inside it.
- [ ] Run status written only by `setRunStatus`; no regression out of final or from `idle` to `running` on replay.
- [ ] No queries in loops; lists use keyset pagination with a capped limit.
- [ ] No secrets in columns; jsonb parsed with Zod.
