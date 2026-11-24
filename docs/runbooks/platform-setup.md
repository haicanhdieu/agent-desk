# Set up the platform

Use this to stand up a new Agent Desk platform (api, worker, web) on Postgres, Temporal and Kubernetes, and to make the first person a platform admin. For a local stack, use [local-dev.md](local-dev.md) instead; it does steps 3 to 5 for you (see "Local stack" below).

Platform admins live in the `platform_admins` table ([ADR-0037](../adr/0037-platform-admins-in-database.md)). Nobody is a platform admin until step 5 has run, and every `/api/platform/*` route answers 403 until then.

## 1. Prerequisites

- Postgres 18 and Temporal reachable from where the api and worker run.
- A Kubernetes cluster for the run pods.
- Images built for the four components: `apps/api/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile` (build from the repository root, for example `docker build -f apps/api/Dockerfile .`) and `images/runner/`. CI builds them in the `images / build` job and checks them with `scripts/smoke-app-images.sh <api|worker|web|runner>`.

## 2. Configure

The api and worker read their config through `packages/core/src/config.ts`. These keys are required (the config refuses to start without them), except `KUBE_MODE`, which defaults to `fake` and which production refuses, so set it there:

| Key                                      | Value                                                          |
| ---------------------------------------- | -------------------------------------------------------------- |
| `PUBLIC_ORIGIN`                          | The URL people open the web app at (a valid URL)               |
| `DATABASE_APP_URL`                       | Runtime connection as `agentdesk_app` (RLS enforced)           |
| `DATABASE_OWNER_URL`                     | Connection as `agentdesk_owner`                                |
| `DATABASE_ADMIN_URL`                     | Connection as a Postgres superuser to the `postgres` database  |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` | Where Temporal listens and the namespace to use                |
| `BETTER_AUTH_SECRET`                     | At least 32 characters                                         |
| `RUNNER_IMAGE`                           | The runner image the run pods use                              |
| `KUBE_MODE`                              | `kubeconfig` or `incluster` in production (`fake` is dev only) |

The migrate step (`apps/api/src/migrate.ts`) also needs `DATABASE_ADMIN_URL` and three passwords it sets on the database roles: `AGENTDESK_OWNER_PASSWORD`, `AGENTDESK_APP_PASSWORD` and `TEMPORAL_PASSWORD`. The URLs in `DATABASE_APP_URL` and `DATABASE_OWNER_URL` must use the same passwords.

Rules the config enforces when `NODE_ENV=production`:

- `AUTH_DEV_LOGIN` and `ENABLE_FAKE_PROVIDER` must not be `true`, and `KUBE_MODE` must not be `fake`.
- `RUN_VOLUME_STORAGE_CLASS` must name a storage class with `reclaimPolicy: Delete`.
- The `GITHUB_*` keys (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) are all set or all empty. Signing in needs at least `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.

[`.env.example`](../../.env.example) is the reference list of every key with a development value. Keep secrets in your secret store, not in the repository.

## 3. Create the database roles and migrate

The migration is the api image with another command (see the comment at the end of `apps/api/Dockerfile`):

```sh
node --import tsx src/migrate.ts   # run in /app/apps/api, which is the image's working directory
```

From a checkout: `pnpm db:migrate`. It creates the roles and databases, then applies every migration as `agentdesk_owner`, and prints `migrate: done`. It is safe to run again.

## 4. Start the api, worker and web

Start the three images with the config from step 2. The api listens on port 3000 and the web image serves on port 8080. Then check the api:

```sh
curl -fsS "$API_URL/healthz"   # {"status":"ok"}: the process is up
curl -fsS "$API_URL/readyz"    # {"status":"ok"}: Postgres and Temporal answer; 503 names the one that does not
```

## 5. Seed the first platform admin

Run this one statement against the `agentdesk` database:

```sql
INSERT INTO platform_admins (email) VALUES ('ops@example.com') ON CONFLICT (email) DO NOTHING;
```

- **Role:** connect as `agentdesk_app` (`DATABASE_APP_URL`) or `agentdesk_owner` (`DATABASE_OWNER_URL`); both can insert. For example `psql "$DATABASE_OWNER_URL" -c "INSERT INTO platform_admins (email) VALUES ('ops@example.com') ON CONFLICT (email) DO NOTHING;"`.
- **Lowercase email:** write the email in lowercase with no spaces. The table refuses anything else, and it must equal the verified email the person signs in with, or they will not be an admin.
- **Not audited:** the product writes an audit entry only for grants and revokes made through `/api/platform/admins`. This manual step leaves none, so note it in your own change log.
- It is safe to run again (`ON CONFLICT DO NOTHING`).

Check with `SELECT email, granted_at FROM platform_admins;`.

## 6. Sign in and create the first org

1. The seeded person signs in with their GitHub account (the verified email must match step 5). No invitation is needed for a seeded email.
2. They create the organization in the web app (Create organization, at `/orgs/new`) or with `POST /api/platform/orgs`.
3. They invite the organization's owner with the platform invitation routes (`POST /api/platform/orgs/:orgId/invitations`). From then on, platform admins list, grant and revoke the role with `GET`, `POST` and `DELETE /api/platform/admins`.

## Suspend and reactivate an organization

A platform admin suspends or reactivates an organization from its page under `/platform`, or with `POST /api/platform/orgs/:orgId/suspend` and `POST /api/platform/orgs/:orgId/reactivate`. Both need the `platform-org:update` permission, which only platform admins hold (an org owner gets 403). The body is `{ "reason": "<1 to 500 characters>" }`; any other key is a 400.

- The change is one transaction on the org row. Suspending an already suspended org (or reactivating an active one) answers 200, changes nothing and writes no audit row, so two admins clicking at once produce one change.
- A change writes two audit rows. The platform audit row (`platform_audit_log`, `target_org_id` set) holds the reason, with token-shaped values masked, and is the only place the reason is stored. The organization's own audit (Settings, Audit) gets an `org.suspended` or `org.reactivated` entry marked "Platform admin", with the status change and no reason. Do not put secrets in a reason.
- The org page shows the current reason, who suspended the org and when, read from the latest `org.suspended` platform audit row.
- What members see: a suspended org's members are refused (the "This organization is suspended" message and an API refusal that names the suspension). Running runs finish. On reactivation members get access back on their next request, paused runs stay paused until someone resumes them, and triggers missed while suspended start no run.
- A platform admin can still edit the name and URL of a suspended org.

## Upgrade

Deploys from before ADR-0037 listed admins in `PLATFORM_ADMIN_EMAILS`. That variable is no longer read: a leftover value is ignored, grants nothing and logs no warning, and nobody is a platform admin after the upgrade. Run step 5 for each former admin before or right after you deploy. Their accounts and org access are untouched.

## Recovery

If the platform has no working admin left (no entry matches a verified account, for example after the only admin's account was removed), run step 5 again with an email that can sign in.

## Local stack

`devbox run dev` does steps 3 to 5 for you. `migrate` runs the migrations, then `seed-dev-admin` seeds `admin@dev.local` into `platform_admins`, and the api starts only after that. The seed runs only when `AUTH_DEV_LOGIN` is `true` (the `.env.example` default); otherwise it prints that it was skipped. It also runs only against a local database (host `localhost`, `127.0.0.1` or `::1`) and skips any other host. `devbox run db-reset` wipes the database, and the next `devbox run dev` migrates and seeds it again. Runner pods use `scripts/runner-stack.sh`, which runs the same seed. See [local-dev.md](local-dev.md) §4.

## Troubleshooting

| Symptom                                                 | Cause and fix                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 403 on every `/api/platform/*` route                    | Step 5 has not run, or the seeded email differs from the signed-in user's verified email. Check `platform_admins` and re-run step 5. |
| Sign-in shows the no-invitation message                 | The seeded email differs from the provider's verified email, or the person has no invitation. Seed the exact lowercase email.        |
| The api refuses to start and names a config key         | A required key from step 2 is missing, or a production rule is broken. Fix the named key; values are never echoed.                   |
| `migrate: failed Missing required environment variable` | Set `DATABASE_ADMIN_URL`, `AGENTDESK_OWNER_PASSWORD`, `AGENTDESK_APP_PASSWORD` and `TEMPORAL_PASSWORD` for the migrate step.         |
| `/readyz` answers 503 `not ready: …`                    | The named service (`postgres` or `temporal`) is not reachable from the api.                                                          |
