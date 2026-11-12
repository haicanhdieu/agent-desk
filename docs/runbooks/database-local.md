# Work with the local database

Migrate, inspect, reset and add migrations against the local Postgres. The rules for schema changes and queries are in [database.md](../conventions/database.md).

**Applies to:** local development only. Every command here targets `localhost:54329`. Never point them at a shared or remote database.

## Connection facts

|              |                                                                                                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Host / port  | `localhost:54329` (container `postgres:18`, compose service `postgres`)                                                    |
| Superuser    | `postgres` / `postgres` (`DATABASE_ADMIN_URL`)                                                                             |
| App database | `agentdesk`                                                                                                                |
| Roles        | `agentdesk_owner` (owns the schema, runs migrations) and `agentdesk_app` (runtime, RLS-enforced). Passwords are in `.env`. |

## Common tasks

```sh
devbox run db-migrate     # roles + migrations; idempotent, safe to repeat
devbox run db-psql        # psql as postgres into agentdesk
devbox run db-reset       # wipe Postgres + Temporal + .agentdesk/fake, then `devbox run dev`
```

`devbox run dev` runs the migration step for you (the `migrate` process) before api and worker start.

### Query as the app role, so RLS is enforced

```sql
SET ROLE agentdesk_app;
SELECT set_config('app.org_id', '<org uuid>', false);
SELECT * FROM projects;   -- only that org's rows
RESET ROLE;
```

Without `app.org_id`, the app role sees no rows at all. That is intended.

## Adding a migration

1. Edit the Drizzle schema in `packages/db/src/schema/`.
2. Generate SQL: `pnpm --filter @agentdesk/db exec drizzle-kit generate --name <what-changed>`.
3. Read the generated SQL. Add the RLS policy and grants for any new `org_id` table.
4. Apply it locally with `devbox run db-migrate`, then run `devbox run test`. The RLS leak test must cover the new table.
5. Commit the schema change and the migration together.

Never edit a migration that has been merged. Write a new one instead. If your own unmerged migration needs a change, regenerate it and run `devbox run db-reset`.

## Seed data

Seed through the app's dev flows (dev login, fake install, `/dev/fake/*`, see [local-dev.md](local-dev.md)), not SQL dumps.
