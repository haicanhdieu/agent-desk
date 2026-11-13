# Workspace Setup and Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every run and every setup test installs the approved plugins the repo enables, then runs the project's saved setup script, then starts the agent (or an idle shell for a test). Users edit, version, test and restore that script from the web app.

**Architecture:** The runner `entrypoint.sh` gains two phases (plugins, setup) between clone and agent, shared by runs and tests (`RUN_MODE=setup_test`). Scripts live in Postgres (`setup_script_versions`, append-only). The worker passes the script and the store allowlist as env values. A setup test is its own entity (`setup_tests`) with its own Temporal workflow and Job, sharing the pod template, the log protocol and the terminal relay with runs.

**Tech Stack:** bash + Node 22 (runner), NestJS/Fastify, Temporal TS SDK, Drizzle/Postgres 18 RLS, Zod contracts, Vite + TanStack Router/Query, Vitest, Testcontainers, `@temporalio/testing`.

**Spec:** `docs/superpowers/specs/2026-11-13-workspace-setup-and-plugins-design.md` (amends control-plane spec §8). The UI already exists as Storybook screens (`apps/web/src/screens/DeskSetup.tsx`, `SetupWorkspace.tsx`, `RunDetail.tsx` with `failureStage`, commit `20d4d0f`); this plan wires them to the API. It does not redesign them.

## Global Constraints

- Repo text, script text and ticket text reach the pod **only as env values or files**. They are never interpolated into shell, k8s specs or SQL. The entrypoint never `eval`s or `source`s them (AGENTS rule 6).
- Plugins install only from marketplaces named in `PLUGIN_MARKETPLACES`, and always from the **configured source**. Repo `extraKnownMarketplaces` is ignored.
- Plugin id parts must match `^[a-z0-9][a-z0-9-]{0,63}$`. Anything else is dropped silently.
- Plugin install failure → warning, then continue. Setup failure in a real run → the run fails with `failure_stage = 'setup'` and Claude never starts.
- Setup timeout: `SETUP_TIMEOUT_SECONDS` (config `RUN_SETUP_TIMEOUT_SECONDS`, default `600`), counted inside the run's existing `timeout_seconds`.
- Test workspace lifetime: `SETUP_TEST_TTL_SECONDS`, default `900`. One active test per project. Tests use no run slots and get **no agent credential**.
- Script max **64 KiB, measured as UTF-8 bytes** (65536), checked in contracts, so web and API agree.
- Write/test authz = org member **and** (project creator **or** org `owner`), the same rule as terminal attach. Read = org member.
- Exact marker strings (each a whole stdout line): `agentdesk: checkout <sha>`, `agentdesk: plugins begin`, `agentdesk: plugin installed <id>`, `agentdesk: plugin skipped <id> (store not approved)`, `agentdesk: plugin failed <id>`, `agentdesk: plugins end`, `agentdesk: setup begin`, `agentdesk: setup skipped (no script)`, `agentdesk: setup passed`, `agentdesk: setup failed exit=<n>`, `agentdesk: setup timed out`, plus the existing `agentdesk: session started`.
- Exit code when setup fails in a real run: **78**. Plugin and setup command output is emitted with the line prefix `plugin| ` / `setup| ` so it can never form a marker.
- Names are provider-agnostic: `setup_*`, `plugins`, `store`. No `github_*`.
- New migrations only (0005 onward). Each new org table ships with its RLS policy, `FORCE ROW LEVEL SECURITY`, a `GRANT` to `agentdesk_app` and FK indexes in the same migration, plus a leak test.
- Sensitive paths (human review): `images/runner/**`, `packages/core/src/kube/job-spec.ts`, `apps/api/src/terminal/**`, `packages/db/migrations/**`.
- Each part below is one PR (~400 lines, one concern). Before every commit: `devbox run fix` until `fix: clean.` Commits are Conventional, scoped by package.

## Review Focus

1. **Setup output that looks like a marker.** A script that echoes `agentdesk: session started` or `agentdesk: setup passed` must not flip the run to `running` or fake a pass. That is why output is prefixed (`setup| `). Test: Task 7 `setup output cannot forge markers`.
2. **Malformed repo settings.** A `.claude/settings.json` that is invalid JSON, not an object, has `enabledPlugins: []`, has `false` values, or has ids with `;`, `$()`, spaces or uppercase must drop those entries and continue to setup and agent. It must never crash or run anything. Tests: Task 1 fixture cases, Task 2 `bad settings still starts the agent`.
3. **Version recorded vs version run.** If `createRunSecretAndJob` retries after a save landed, the run must still record the version whose body the pod got. Test: Task 8 `retry reuses the recorded script version`.
4. **Two quick Test clicks / test while one is open.** Only one test stays active, and the older test's pod is deleted. Test: Task 12 `starting a test ends the previous one`.
5. **Byte-size edges.** A 65536-byte script with multi-byte characters is accepted. 65537 bytes is rejected (400) by API and web alike. CRLF and no trailing newline round-trip unchanged. Tests: Task 5 contract cases, Task 6 `stores body byte-exact`.

---

## Part A: PR 1, plugins phase (runner, core, worker, docs)

### Task 1: Runner package and plugin selection

**Files:**
- Create: `images/runner/package.json` (`@agentdesk/runner`, private, scripts `test: vitest run`, `typecheck: tsc --noEmit`, `lint: eslint .`), `images/runner/tsconfig.json`, `images/runner/vitest.config.ts`
- Create: `images/runner/select-plugins.mjs`
- Create: `images/runner/test/fixtures/plugin-selection.json` (shared with Task 14)
- Create: `images/runner/test/select-plugins.test.ts`
- Modify: `pnpm-workspace.yaml` (add `images/*`)

**Interfaces:**
- Produces: `selectPlugins(settingsText: string | null, marketplaces: Record<string, string>): { install: { plugin: string; store: string; source: string }[]; skipped: string[] }`. Also a CLI: `node select-plugins.mjs <settings-path>` reads `PLUGIN_MARKETPLACES` and prints one line per result: `install\t<plugin>\t<store>\t<source>` or `skip\t<plugin>@<store>`. A missing file, invalid JSON or invalid `PLUGIN_MARKETPLACES` prints nothing and exits 0.
- Produces: fixture format `[{ "name": string, "settings": string | null, "marketplaces": {..}, "install": ["plugin@store", ...], "skipped": ["plugin@store", ...] }]`.

- [ ] **Step 1: Write the fixture and failing test.** Fixture cases, at minimum:
  - `null`
  - `"not json"`
  - `"[]"`
  - `{"enabledPlugins": []}`
  - `{"enabledPlugins": {"superpowers@claude-plugins-official": true, "x@claude-plugins-official": false}}` → install `superpowers@claude-plugins-official`
  - unapproved store `foo@evil-store` → skipped
  - `"a;rm -rf /@claude-plugins-official"`, `"A@claude-plugins-official"`, `"$(x)@s"`, `"no-at-sign"`, `"a@b@c"` → neither list
  - `extraKnownMarketplaces` naming `claude-plugins-official` with a different source → installed from the **config** source

  The test iterates the fixture with `expect(toIds(selectPlugins(c.settings, c.marketplaces))).toEqual({ install: c.install, skipped: c.skipped })`. A second test runs the CLI via `execFile(process.execPath, [script, file], { env: { PLUGIN_MARKETPLACES } })` and asserts the exact tab-separated stdout.
- [ ] **Step 2: Run `pnpm install && pnpm --filter @agentdesk/runner test`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `select-plugins.mjs`** (plain ESM, no dependencies; it runs in the image). Output is sorted by store, then plugin, for stable logs.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(runner): plugin selection from repo settings`.

### Task 2: Entrypoint plugins phase, CLI spike, ADR, runner contract

**Files:**
- Modify: `images/runner/entrypoint.sh`, `images/runner/Dockerfile` (copy `select-plugins.mjs` to `/usr/local/lib/agentdesk/`)
- Create: `images/runner/test/stubs/{git,claude,tmux,timeout}` (executable node scripts that append their argv as JSON lines to `$STUB_LOG`), `images/runner/test/harness.ts`, `images/runner/test/entrypoint.test.ts`
- Create: `docs/adr/0019-repo-setup-and-approved-store-plugins.md`
- Modify: `docs/superpowers/specs/2026-11-12-control-plane-design.md` §8, `docs/superpowers/specs/2026-11-12-infra-design.md` (egress note: pod egress must reach the plugin marketplace sources and package registries), `docs/adr/README.md`

**Interfaces:**
- Consumes: `select-plugins.mjs` CLI (Task 1).
- Produces: entrypoint env contract: `PLUGIN_MARKETPLACES` (JSON), optional; `AGENTDESK_REPO_DIR` (default `/workspace/repo`) and `AGENTDESK_LIB_DIR` (default `/usr/local/lib/agentdesk`), both test seams only. Also the markers `checkout`, `plugins begin/end`, `plugin installed/skipped/failed` from Global Constraints.
- Produces: `runEntrypoint(env: Record<string,string>, repoFixture: Record<string,string>): Promise<{ stdout: string[]; exitCode: number; calls: { cmd: string; argv: string[] }[] }>` in `harness.ts`. The `git` stub's `clone` creates the repo dir from `repoFixture`. The `tmux` stub reports `pane_dead=1`, status 0. The `claude plugin ...` stub fails when its argv contains `STUB_FAIL_PLUGIN`.

- [ ] **Step 1: Spike on the pinned CLI** (`CLAUDE_CODE_VERSION=2.1.323`). Build the image with `podman build -t agentdesk-runner:dev images/runner` (or `docker`). Then run `claude plugin --help`, `claude plugin marketplace add anthropics/claude-plugins-official` and `claude plugin install superpowers@claude-plugins-official` inside it with `</dev/null` under `timeout 120`. Record in the ADR:
  - the exact commands
  - whether any prompt appears, and which `~/.claude.json` / `settings.json` keys pre-accept it
  - which marketplace **name** each default source registers as

  Check: both installs exit 0 with stdin closed. Any default name that does not register from its source is dropped from the default config (Task 3), and the ADR says so.
- [ ] **Step 2: Write failing entrypoint tests:**
  - `installs approved plugins with one argv element per value`: asserts the `claude` stub calls equal the spike's commands, e.g. `['plugin','marketplace','add','<source>']` then `['plugin','install','superpowers@claude-plugins-official']`.
  - `skips unapproved store`: the marker line is present, and there is no install call.
  - `plugin failure warns and continues`: `plugin failed <id>` is printed, and the claude session still starts.
  - `bad settings still starts the agent`: covers invalid JSON and a hostile id (Review Focus 2).
  - `prints checkout sha`: matches `/^agentdesk: checkout [0-9a-f]{40}$/`.
  - `plugin output is prefixed`: every non-marker line between `plugins begin` and `plugins end` starts with `plugin| `.
- [ ] **Step 3: Run `pnpm --filter @agentdesk/runner test`.** Expected: FAIL.
- [ ] **Step 4: Implement the phase** in `entrypoint.sh`, after checkout and the `.claude.json` write, before tmux. Wrap each CLI call in `timeout 120`. Pipe output through `sed -u 's/^/plugin| /'` and read the exit status via `PIPESTATUS`. Add any pre-accept keys the spike found to the `.claude.json` heredoc.
- [ ] **Step 5: Run the tests.** Expected: PASS. Then rebuild the image and repeat Step 1's check through the entrypoint (`RUN_MODE` unset, a test repo with `enabledPlugins`). Expected: `plugin installed superpowers@…`.
- [ ] **Step 6: Write the ADR (decision 8: credentials visible to setup are accepted) and amend §8.** List the new env vars, markers, the prefixes, exit code 78 and `RUN_MODE=setup_test`; Task 7 adds the setup half to the same section.
- [ ] **Step 7: Commit** `feat(runner): install approved-store plugins before the agent` (docs in the same commit).

### Task 3: Core markers, config, Job env, fake pod

**Files:**
- Modify: `packages/core/src/kube/log-parser.ts`, `packages/core/src/config.ts`, `packages/core/src/kube/job-spec.ts`, `packages/core/src/kube/fake-pod.mjs`, `.env.example`
- Test: `packages/core/test/kube/log-parser.test.ts`, `packages/core/test/config.test.ts`, `packages/core/test/kube/job-spec.test.ts`, `packages/core/test/kube/fake-gateway.test.ts`

**Interfaces:**
- Produces: `LogLineKind` gains `'checkout' | 'plugins_begin' | 'plugin_installed' | 'plugin_skipped' | 'plugin_failed' | 'plugins_end' | 'setup_begin' | 'setup_skipped' | 'setup_passed' | 'setup_failed' | 'setup_timed_out' | 'setup_output' | 'plugin_output'`. `ParsedLogLine` gains optional `pluginId?: string`, `exitCode?: number`, `sha?: string`. Lines that start with `setup| ` or `plugin| ` parse as `setup_output` / `plugin_output`, with `text` stripped of the prefix. Parameterised markers are matched by anchored regex on the trimmed line, with ids validated by the Global Constraints slug rule.
- Produces: config `RUN_PLUGIN_MARKETPLACES: Record<string,string>` (JSON, default from the spike), `RUN_SETUP_TIMEOUT_SECONDS: number` (default 600, 1–3300), `SETUP_TEST_TTL_SECONDS: number` (default 900, 60–3600).
- Produces: `RunJobInput` gains `pluginMarketplaces: Record<string,string>` and `setupTimeoutSeconds: number`. `buildRunJob` emits env `PLUGIN_MARKETPLACES` (JSON.stringify) and `SETUP_TIMEOUT_SECONDS`.

- [ ] **Step 1: Write failing tests:**
  - parser table: each marker → kind; `'agentdesk: plugin installed BAD ID'` → `text`; `'setup| agentdesk: session started'` → `setup_output` with text `agentdesk: session started`
  - config defaults and rejection of a non-object `RUN_PLUGIN_MARKETPLACES`
  - job spec env contains both values
  - the fake pod logs `plugins begin` / `plugins end` before `session started`
- [ ] **Step 2: Run `pnpm --filter @agentdesk/core test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** In the fake pod, print `agentdesk: checkout 0000…0` (40 zeros), `plugins begin` and `plugins end`, then continue as today.
- [ ] **Step 4: Run the core tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): plugin markers, setup config and job env`.

### Task 4: Worker stores plugin events; `running` only from session start

**Files:**
- Modify: `apps/worker/src/activities/run.activities.impl.ts` (`createRunSecretAndJob`, `followPodLogs`)
- Test: `apps/worker/test/run.activities.test.ts`

**Interfaces:**
- Consumes: Task 3 kinds and config.
- Produces: `run_events` `lifecycle` payloads `{ line, kind, text, pluginId? , sha? }` for every non-`text`, non-output marker. `runs.status` changes `starting → running` only on `session_started`.

- [ ] **Step 1: Write failing tests** with the fake gateway log:
  - `stays starting through plugin lines`: after `plugins begin`/`plugins end` the status is `starting`; after `session started` it is `running`
  - `stores plugin markers as lifecycle events`: kinds `plugins_begin`, `plugin_installed` with `pluginId`
  - `passes allowlist and timeout to the Job`: `podEnv('run-…')` has `PLUGIN_MARKETPLACES` and `SETUP_TIMEOUT_SECONDS`
- [ ] **Step 2: Run `pnpm --filter @agentdesk/worker test -- run.activities`.** Expected: FAIL.
- [ ] **Step 3: Implement.** Replace the `runningChecked` first-line logic with a write on `session_started` (still `onlyFrom: ['starting']`, so a replayed line is harmless).
- [ ] **Step 4: Run the worker tests,** including the `run.workflow` replay fixtures. Expected: PASS. Also run `pnpm --filter @agentdesk/worker typecheck`.
- [ ] **Step 5: Commit** `feat(worker): plugin events and running on session start`.

---

## Part B: PR 2, setup script storage (db, contracts, API)

### Task 5: `setup_script_versions` table and contracts

**Files:**
- Modify: `packages/db/src/schema/app.ts`; generate `packages/db/migrations/0005_setup_script_versions.sql` (`pnpm --filter @agentdesk/db db:generate --name setup_script_versions`), then append by hand `FORCE ROW LEVEL SECURITY` and `GRANT SELECT, INSERT ON setup_script_versions TO agentdesk_app` (append-only: no UPDATE or DELETE grant)
- Create: `packages/contracts/src/schemas/setup.ts`; modify `packages/contracts/src/routes.ts`, `packages/contracts/src/index.ts`
- Test: `packages/db/test/rls.test.ts`, `packages/db/test/migrate.test.ts`, `packages/contracts/src/routes.test.ts`

**Interfaces:**
- Produces table `setupScriptVersions`: `id uuid pk, org_id, project_id fk→projects cascade, version int not null, body text not null, note text null, created_by text not null (user id), created_at timestamptz`. Constraints: unique `setup_script_versions_project_version_key (project_id, version)`, `check (octet_length(body) <= 65536)`, `check (note is null or char_length(note) <= 200)`. Index `setup_script_versions_org_idx`. `orgPolicy()`.
- Produces contracts:
  - `SetupScriptBody = z.string().refine(s => new TextEncoder().encode(s).length <= 65536, 'Setup script is larger than 64 KiB')`, exported with `SETUP_SCRIPT_MAX_BYTES = 65536`
  - `SetupScriptDto { version: int, body: string, note: string|null, createdBy: string /* handle */, createdAt: Timestamp }`
  - `SetupScriptVersionDto` = `SetupScriptDto` without `body`
  - `PutSetupScriptRequest { body: SetupScriptBody, note?: string (max 200), baseVersion: int | null }`
  - routes `setupScript.get` (`GET /api/projects/:projectId/setup-script` → `SetupScriptDto.nullable()`), `setupScript.put` (`PUT …` → `SetupScriptDto`), `setupScript.versions` (`GET …/setup-script/versions` → `SetupScriptVersionDto[]`), `setupScript.version` (`GET …/setup-script/versions/:version` → `SetupScriptDto`)

- [ ] **Step 1: Write failing tests:**
  - RLS leak test for the new table (pattern of the existing cases)
  - `agentdesk_app cannot UPDATE or DELETE setup_script_versions` (42501)
  - contracts: 65536 bytes of `'é'.repeat(32768)` accepted, one more byte rejected; route count bumped by 4
- [ ] **Step 2: Run `pnpm --filter @agentdesk/db test && pnpm --filter @agentdesk/contracts test`.** Expected: FAIL.
- [ ] **Step 3: Implement the schema,** generate the migration, append the RLS/grant SQL, and add the contracts.
- [ ] **Step 4: Run both suites.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): setup script versions` and `feat(contracts): setup script routes`.

### Task 6: Setup script API

**Files:**
- Create: `apps/api/src/setup/setup-script.service.ts`, `apps/api/src/setup/setup-script.controller.ts`, `apps/api/src/setup/setup.module.ts`, `apps/api/src/projects/project-access.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/audit/audit.interceptor.ts`, `apps/api/src/audit/redact-body.ts`
- Test: `apps/api/test/setup-script.test.ts`, `apps/api/src/audit/redact-body.test.ts`

**Interfaces:**
- Produces: `assertCanEditProject(tx: Tx, org: OrgContext, projectId: string): Promise<void>`. It throws 404 when the project is not visible and 403 unless `org.role === 'owner'` or `projects.created_by === org.userId`. Tasks 12 and 14 reuse it.
- Produces: `SetupScriptService.current(tx, projectId): Promise<{ version: number; body: string } | null>`. The worker does not import api code; Task 8 repeats this one query in the worker.
- Produces: audit payloads for `PUT setupScript.put` and `POST setupTests.create` replace `body` / `script` with `{ sha256, bytes }`. The script text is never written to `audit_log` or logs.

- [ ] **Step 1: Write failing API tests:**
  - GET with no versions → `null`
  - PUT with `baseVersion: null` → version 1; PUT with base 1 → 2; PUT with a stale base → 409 problem+json
  - `stores body byte-exact`: CRLF, no trailing newline, emoji round-trip
  - 65537 bytes → 400
  - empty body allowed (means "no setup")
  - a non-creator member PUT → 403; that member GET → 200; another org → 404
  - versions list has no `body`; version N returns its body
  - restore = PUT with N's body creates N+1
  - `audit_log` payload has `sha256` and no `body` key
- [ ] **Step 2: Run `pnpm --filter @agentdesk/api test -- setup-script`.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `put`, do it all under `withOrg`: `SELECT … FROM projects WHERE id = $1 FOR UPDATE`, then read max version, compare with `baseVersion` (409 when different), then insert `max+1`. Map `createdBy` to `user.handle` as the other services do.
- [ ] **Step 4: Run the api tests and `pnpm --filter @agentdesk/api typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): versioned setup script endpoints`.

---

## Part C: PR 3, setup phase in runs

### Task 7: Entrypoint setup phase and modes

**Files:**
- Modify: `images/runner/entrypoint.sh`, `packages/core/src/kube/fake-pod.mjs`, control-plane spec §8 (setup half)
- Test: `images/runner/test/entrypoint.test.ts`, `packages/core/test/kube/fake-gateway.test.ts`

**Interfaces:**
- Produces: env `SETUP_SCRIPT` (optional), `SETUP_TIMEOUT_SECONDS` (non-digits → 600), `RUN_MODE` (`setup_test` or unset). Behaviour:
  - Script written with `printf '%s'` to `mktemp`, run as `timeout "$SETUP_TIMEOUT_SECONDS" bash "$file"` with cwd `$REPO_DIR`, stdout and stderr through `sed -u 's/^/setup| /'`.
  - `unset SETUP_SCRIPT` before tmux starts.
  - Exit 124 → `setup timed out`.
  - Real mode + failure → exit 78, no tmux.
  - Test mode → tmux session `agent` running `bash -l` in `$REPO_DIR` (pass or fail), then the existing wait/scrollback loop.
- Produces (fake pod): `RUN_MODE=setup_test` → plugins/setup markers, `setup passed`, unless `SETUP_SCRIPT` includes `--fake-setup-fail` (→ `setup failed exit=1`). The fake pod never executes the script. Real mode with `--fake-setup-fail` → exit 78 before `session started`. Test mode → `session started`, the pane echoes typed lines, no turn markers.

- [ ] **Step 1: Write failing tests:**
  - `no script prints setup skipped`
  - `passing script runs in repo dir`: the script `pwd` outputs `setup| <repo>`
  - `failing script exits 78 without tmux`
  - `timeout prints setup timed out`: `SETUP_TIMEOUT_SECONDS=1`, script `sleep 5`
  - `setup output cannot forge markers` (Review Focus 1): the script echoes `agentdesk: setup passed` and then `exit 1`. Stdout has `setup| agentdesk: setup passed` and `agentdesk: setup failed exit=1`
  - `script text is not evaluated by the entrypoint`: `SETUP_SCRIPT='$(touch /tmp/x)'` is only run by `bash file`, and the entrypoint's own trace shows no expansion
  - `test mode starts bash -l after failure`: the tmux stub argv contains `bash -l`
  - fake gateway: real mode with `--fake-setup-fail` exits 78
- [ ] **Step 2: Run `pnpm --filter @agentdesk/runner test && pnpm --filter @agentdesk/core test`.** Expected: FAIL.
- [ ] **Step 3: Implement both.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(runner): setup script phase and setup test mode`.

### Task 8: Run records script version; `SETUP_SCRIPT` reaches the Job

**Files:**
- Modify: `packages/db/src/schema/app.ts` + migration `0006_runs_setup_columns.sql` (`setup_script_version int null`, `failure_stage text null` with `runs_failure_stage_check in ('setup','agent')`)
- Modify: `packages/contracts/src/schemas/runs.ts` (`RunDto.setupScriptVersion: int|null`, `RunDto.failureStage: z.enum(['setup','agent']).nullable()`), `apps/api/src/runs/runs.service.ts` (map both)
- Modify: `packages/core/src/kube/job-spec.ts` (`RunJobInput.setupScript: string | null` → env `SETUP_SCRIPT` only when non-empty), `apps/worker/src/activities/run.activities.impl.ts`
- Test: `packages/core/test/kube/job-spec.test.ts`, `apps/worker/test/run.activities.test.ts`, `apps/api/test/runs.test.ts`, `packages/db/test/migrate.test.ts`

**Interfaces:**
- Produces: `createRunSecretAndJob` reads `runs.setup_script_version` and works in two cases:
  - **When null:** it reads the project's current version under `withOrg` and writes it to the run (or leaves the column null if there is no script or the body is empty), **before** `ensureJob`.
  - **When set:** it loads that version's body.

  The body becomes `RunJobInput.setupScript`. The script never enters Temporal history.

- [ ] **Step 1: Write failing tests:**
  - job spec: `SETUP_SCRIPT` present iff non-empty
  - activity: `passes the current script and records its version`
  - `retry reuses the recorded script version` (Review Focus 3): first attempt with ensureJob throwing after the version is written, then a new version saved, then a second attempt → `podEnv` has the old body and the run row keeps the old version
  - api: `RunDto` includes both new fields
- [ ] **Step 2: Run the worker, core and api tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and typecheck all touched packages.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): pass saved setup script to run jobs`.

### Task 9: Setup failure stage, setup output events, finish comment

**Files:**
- Create: `packages/core/src/kube/setup-log.ts` (pure)
- Modify: `apps/worker/src/activities/run.activities.ts` (`FollowPodLogsResult.failureStage?: 'setup'`, `FinishDetails.failureStage?`), `run.activities.impl.ts`, `run-status.activity.ts` (`SetRunStatusInput.failureStage?: 'setup' | 'agent'`, written with the final status), `apps/worker/src/workflows/run.workflow.ts`
- Test: `packages/core/test/kube/setup-log.test.ts`, `apps/worker/test/run.activities.test.ts`, `apps/worker/test/run.workflow.test.ts`, `apps/worker/test/run-status.activity.test.ts`

**Interfaces:**
- Produces: `class SetupLogTracker { constructor(opts: { chunkLines: number /*50*/, maxChars: number /*262144*/ }); push(p: ParsedLogLine): SetupLogEffect[]; flush(): SetupLogEffect[]; readonly summary: SetupSummary }`.
  - `SetupLogEffect = { kind: 'event'; payload: { kind: LogLineKind; text: string; pluginId?: string; exitCode?: number; sha?: string } } | { kind: 'output'; payload: { kind: 'setup_output' | 'plugin_output'; text: string; truncated: boolean } }`.
  - `SetupSummary = { checkoutSha: string | null; plugins: { installed: string[]; skipped: string[]; failed: string[] }; setup: 'pending' | 'skipped' | 'passed' | 'failed' | 'timed_out'; exitCode: number | null }`.
  - Output lines are batched into chunks of 50 lines and flushed on any marker. When `maxChars` is reached, one `truncated: true` chunk is emitted and later output is dropped. Task 11 reuses this class for tests.
- Produces: `followPodLogs` stores effects as `lifecycle` events (output text redacted with the run's secret list). It advances `durable` only after a chunk is stored, as it does for scrollback. On return it sets `failureStage: 'setup'` when the run has a stored `setup_failed` or `setup_timed_out` lifecycle event and no `session_started` event. It queries `run_events`, so it survives activity retries. The workflow maps this to `{ status: 'failed', failureReason: 'setup failed (exit N)' | 'setup timed out', failureStage: 'setup' }` and omits `scrollbackTail`. An agent non-zero exit gets `failureStage: 'agent'`. The finish comment for `setup` reads: `Agent Desk run #N failed during workspace setup; the agent did not start.` followed by `Reason:` and `Run: <link>`.

- [ ] **Step 1: Write failing tests:**
  - tracker: chunking at 50 lines, flush on marker, truncation, plugin summary lists, `setup_timed_out`
  - activity: `setup failure returns failureStage setup` with fake `--fake-setup-fail`, status stays `starting` until final, and output chunks are stored redacted (secret value replaced)
  - workflow (mocked activities): `failed in setup` → `setRunStatus` called with `failureStage: 'setup'`, and the finish details carry it with no tail
  - existing replay fixtures still pass (no new workflow commands: only result mapping changes)
  - `setRunStatus` persists `failure_stage`
- [ ] **Step 2: Run the core and worker tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests (including the replay tests).** Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): setup failure stage and setup log events`.

---

## Part D: PR 4a/4b, setup tests (backend)

### Task 10: Setup test tables, Job spec, gateway support

**Files:**
- Modify: `packages/db/src/schema/app.ts` + migration `0007_setup_tests.sql` (both tables, RLS, FORCE, grants, FK indexes)
- Modify: `packages/core/src/kube/gateway.ts`, `job-spec.ts`, `fake-gateway.ts`, `real-gateway.ts`
- Test: `packages/db/test/rls.test.ts`, `packages/core/test/kube/{job-spec,fake-gateway,real-gateway}.test.ts`

**Interfaces:**
- Produces table `setupTests`: `id uuid pk, org_id, project_id fk cascade, status text check in ('queued','running','passed','failed','ended'), script_sha256 text not null, script_body text null /* cleared when the test ends */, checkout_sha text null, plugins jsonb not null default '{"installed":[],"skipped":[],"failed":[]}', exit_code int null, started_by text not null, created_at, finished_at null /* setup result known */, ended_at null /* workspace deleted */`. Indexes: `setup_tests_project_created_idx (project_id, created_at desc)` and `setup_tests_org_idx`.
- Produces table `setupTestEvents`: `org_id, setup_test_id fk cascade, seq int, ts, type text check in ('lifecycle','status'), payload jsonb`, pk `(setup_test_id, seq)`, index on org.
- Produces in `gateway.ts`: `SETUP_TEST_LABELS = { kind: 'agentdesk/kind', setupTestId: 'agentdesk/setup-test-id' }` (kind value `setup-test`), `setupTestJobName(id) = \`setup-test-${id}\``, `KubeGateway.listSetupTestJobs(): Promise<{ jobName: string; setupTestId: string; orgId: string; projectId: string }[]>`. A secret of the same name holds the clone URL and runEnv.
- Produces in `job-spec.ts`: `buildSetupTestJob(input: { setupTestId; orgId; projectId; image; checkoutRef; script: string; pluginMarketplaces; setupTimeoutSeconds; ttlSeconds; botName; botEmail; pod: RunPodConfig }): V1Job`, with env `RUN_MODE=setup_test` and `activeDeadlineSeconds = setupTimeoutSeconds + ttlSeconds + 300` (final review: the margin became 420 + 10 × 120 + 10 = 1630 s, for Pending, the clone, ten plugin commands at 120 s each and the setup kill grace). `buildRunJob` and `buildSetupTestJob` share one private `podJob(...)` helper, so the security context, resources and volumes cannot drift.
- Fake gateway: job-name regex accepts `^(run|setup-test)-[a-z0-9-]{1,60}$`. `listRunJobs` keeps returning only `run-*`.

- [ ] **Step 1: Write failing tests:**
  - RLS leak tests for both tables
  - `buildSetupTestJob` has the same `securityContext`/`resources`/`volumes` as `buildRunJob` (deep-equal on those paths), labels include kind and id, no `agentdesk/run-id`, `PROMPT` absent
  - fake gateway runs a `setup-test-…` job to `session started` and `listSetupTestJobs` returns it
  - the real gateway lists by label selector `agentdesk/kind=setup-test`
- [ ] **Step 2: Run the db and core tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): setup tests tables` and `feat(core): setup test job and gateway support`.

### Task 11: `SetupTestWorkflow`, activities, reconcile

**Files:**
- Create: `apps/worker/src/workflows/setup-test.workflow.ts`, `apps/worker/src/activities/setup-test.activities.ts` (interface), `setup-test.activities.impl.ts`, `apps/worker/src/activities/setup-test-events.ts`
- Modify: `apps/worker/src/workflows/index.ts`, `signals.ts` (`endSetupTest`), `apps/worker/src/activities/index.ts`, `reconcile.activity.ts`, `packages/core/src/temporal-names.ts` (`setupTestWorkflowId(id) = \`setup-test-${id}\``)
- Test: `apps/worker/test/setup-test.workflow.test.ts`, `apps/worker/test/setup-test.activities.test.ts`, `apps/worker/test/reconcile.test.ts` (create if absent; otherwise extend the existing reconcile cases)

**Interfaces:**
- Produces: `SetupTestWorkflow(input: { orgId: string; setupTestId: string }): Promise<{ status: 'passed' | 'failed' | 'ended' }>`. Flow:
  1. `createSetupTestJob`
  2. `followSetupTestLogs` (returns at the setup result marker or at pod exit)
  3. `await condition(() => ended, ttlSeconds * 1000)`
  4. `finalizeSetupTest` (non-cancellable: delete Job and Secret, set `ended_at`, `script_body = null`, status `ended` if no result yet)

  The `endSetupTest` signal sets `ended` and also cancels steps 1–2.
- Produces activities (no script or token in arguments or results):
  - `createSetupTestJob(ref: { orgId; setupTestId }): Promise<{ ttlSeconds: number }>`. It mints the workspace token, then creates the Secret (clone URL + `runEnv`, **no agent credential**), then the Job with the body read from `setup_tests.script_body` and checkout ref `projects.default_branch`. It then sets status `running`.
  - `followSetupTestLogs(ref): Promise<void>`. Heartbeating. It uses `SetupLogTracker` (Task 9) and appends to `setup_test_events` with redaction. On a result it writes `status passed|failed`, `exit_code`, `checkout_sha`, `plugins`, `finished_at`.
  - `finalizeSetupTest(ref): Promise<void>`.
- Reconcile: adds a step that deletes setup-test Jobs and Secrets whose test row is missing, has `ended_at`, or is older than `created_at + ttl + setup timeout + 600 s`.

- [ ] **Step 1: Write failing tests:**
  - workflow (time-skipping, mocked activities): `passes then ends after TTL`, `end signal before result ends immediately and finalizes once`, `finalize runs even when create throws`
  - activities against the fake gateway: `test pod env has no agent credential` (assert none of `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` in `podEnv`), `records plugins and checkout`, `failed setup records exit code`, `finalize clears script_body`
  - reconcile: `deletes orphaned setup test job`
- [ ] **Step 2: Run `pnpm --filter @agentdesk/worker test`.** Expected: FAIL.
- [ ] **Step 3: Implement** and register the workflow and activities in the worker.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): setup test workflow`.

### Task 12: Setup test API (create, latest, end, events)

**Files:**
- Modify: `packages/contracts/src/schemas/setup.ts`, `routes.ts`
- Create: `apps/api/src/setup/setup-tests.service.ts`, `setup-tests.controller.ts`, `apps/api/src/setup/setup-test-stream.ts`
- Test: `apps/api/test/setup-tests.test.ts`, `packages/contracts/src/routes.test.ts`

**Interfaces:**
- Produces contracts:
  - `SetupTestStatus = z.enum(['queued','running','passed','failed','ended'])`
  - `SetupTestDto { id, projectId, status, scriptSha256, matchesCurrentScript: boolean, checkoutSha: string|null, plugins: { installed: string[]; skipped: string[]; failed: string[] }, exitCode: int|null, startedBy: string, createdAt, finishedAt: Timestamp|null, endedAt: Timestamp|null, endsAt: Timestamp|null }`
  - `CreateSetupTestRequest { script: SetupScriptBody }`
  - routes `setupTests.create` (`POST /api/projects/:projectId/setup-tests`), `setupTests.latest` (`GET …/setup-tests/latest` → `SetupTestDto.nullable()`), `setupTests.end` (`POST /api/setup-tests/:setupTestId/end` → null), `setupTests.events` (SSE, query `after`, `event: status` = `SetupTestDto`, `event: event` = `RunEventDto`), `setupTests.terminal` (WS, Task 13)
  - `matchesCurrentScript` = `scriptSha256 === sha256(current body ?? '')`. `endsAt` = `finishedAt + SETUP_TEST_TTL_SECONDS` while `endedAt` is null.
- `create`: `assertCanEditProject`, then in one tx (lock the project row `FOR UPDATE`): pick the previous tests with `ended_at is null`, insert the new row (`queued`, sha256, `script_body`). After commit: signal `endSetupTest` to each previous workflow (best effort, logged by error name) and start `SetupTestWorkflow` with id `setup-test-{id}`.
- `events`: authz as the run SSE does, then a backlog from `setup_test_events`. Live updates come from **polling every 1 s** (at most one active test per project, so LISTEN plumbing is not worth it). The stream closes after `ended_at` once the backlog is sent.

- [ ] **Step 1: Write failing tests** (fake Temporal helper):
  - create → 200 `queued` and the workflow started with `{ orgId, setupTestId }` only (no script in the args)
  - `starting a test ends the previous one` (Review Focus 4): two creates in parallel → exactly one row with `ended_at is null` after both commit and `endSetupTest` signalled for the other
  - non-creator → 403
  - latest → newest row, `matchesCurrentScript` true/false
  - end by a non-creator → 403, by another org → 404
  - SSE backlog then a live event, `after` honoured
  - audit row has no `script`
- [ ] **Step 2: Run `pnpm --filter @agentdesk/api test -- setup-tests` and the contracts tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(contracts): setup test routes` and `feat(api): setup test endpoints and stream`.

### Task 13: Terminal relay for setup tests

**Files:**
- Modify: `apps/api/src/terminal/terminal.gateway.ts`
- Create: `apps/api/src/terminal/terminal-targets.ts`
- Test: `apps/api/test/terminal.test.ts`

**Interfaces:**
- Produces: `interface TerminalTarget { kind: 'run' | 'setup-test'; path: string; lookup(tx: Tx, id: string): Promise<{ createdBy: string; active: boolean; jobName: string } | null>; onAttach?(id: string): Promise<void>; onDetach?(id: string): Promise<void> }`.
  - `runTarget`: today's query; active = `running | idle`; attach/detach signals the run workflow.
  - `setupTestTarget`: active = `ended_at is null` and status ≠ `queued`; job `setup-test-{id}`; no signals.

  The gateway registers one websocket route per target and keys its connection map by `${kind}:${id}`. The close codes, origin check, reauth, caps and byte handling stay exactly as they are.

- [ ] **Step 1: Write failing tests:**
  - setup test attach works end-to-end with the fake gateway (typed `echo hi\r` comes back)
  - non-creator member → 4403; other org → 4403; ended test → 4409; bad origin → 4403
  - all existing run terminal tests unchanged and passing
- [ ] **Step 2: Run `pnpm --filter @agentdesk/api test -- terminal`.** Expected: FAIL (new cases).
- [ ] **Step 3: Refactor `check`/`start` to take a `TerminalTarget`.**
- [ ] **Step 4: Run all api tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): terminal relay for setup tests`.

---

## Part E: PR 5a/5b, plugins panel API and Desk Setup tab

### Task 14: Plugins panel endpoint

**Files:**
- Modify: `packages/core/src/adapters/types.ts` (`CodeHostAdapter.readRepoFile(project: AdapterProject, path: string): Promise<string | null>`), `adapters/github/codehost.ts`, `adapters/fake/codehost.ts` + `fake/store.ts`
- Create: `packages/core/src/plugins/select-plugins.ts` (TS twin of Task 1's function, same signature)
- Modify: `packages/contracts/src/schemas/setup.ts`, `routes.ts`; `apps/api/src/setup/setup-script.controller.ts` (or a small `plugins.controller.ts`)
- Test: `packages/core/test/plugins.test.ts` (reads `../../images/runner/test/fixtures/plugin-selection.json`), `packages/core/test/adapters/{github,fake}.test.ts` (recorded payload `contents.settings-file.json`), `apps/api/test/setup-script.test.ts`

**Interfaces:**
- Produces: `PluginsDto { approvedStores: string[]; plugins: { id: string; name: string; store: string; state: 'will_install' | 'blocked' }[]; settingsError: 'unreadable' | null }` and route `setup.plugins` (`GET /api/projects/:projectId/plugins`, read authz). The repo file is read at the project's default branch. A 404 maps to `null` → empty list. An adapter error maps to `settingsError: 'unreadable'` with a 200, so the tab still renders.

- [ ] **Step 1: Write failing tests:**
  - core twin passes every shared fixture case (the same file as the runner, so the panel and the pod cannot disagree)
  - github adapter decodes base64 contents and returns null on 404
  - api returns `will_install`/`blocked` from the fake repo's settings
- [ ] **Step 2: Run the core and api tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): read repo file and select plugins` and `feat(api): plugins panel endpoint`.

### Task 15: Desk Setup route wired to the API

**Files:**
- Create: `apps/web/src/app/routes/o.$org.p.$project.desk.setup.tsx`, `apps/web/src/features/setup-script/{queries.ts,mutations.ts,map.ts,map.test.ts,useSetupTest.ts,setup.route.test.tsx}`
- Modify: `apps/web/src/features/runs/useTerminal.ts` (extract `useTerminalSocket(path: string, enabled, term, onSessionEnd: () => void)`; `useTerminal` wraps it unchanged), `apps/web/src/features/desk/frame.ts` (pass `links.setup` so the nav item shows), `apps/web/src/features/runs/detail.map.ts` + `map.ts` (`failureStage`, `setupScriptVersion` → the existing screen props), `apps/web/src/mocks/dto/*` + `apps/web/src/mocks/msw/handlers.ts` + `stream-handlers.ts` (fixtures and handlers for every new route), `apps/web/CONTRACT-GAPS.md` if a gap is found
- Test: the files above plus `apps/web/src/mocks/msw/contract.test.ts`, `apps/web/src/features/runs/useTerminal.test.tsx`, `apps/web/e2e/mock/setup.spec.ts`

**Interfaces:**
- Consumes: routes `setupScript.*`, `setupTests.*`, `setup.plugins`; `DeskSetupProps` (existing, unchanged).
- Produces: `toDeskSetupProps(data: { script: SetupScriptDto | null; versions: SetupScriptVersionDto[]; plugins: PluginsDto; latest: SetupTestDto | null; events: RunEventDto[] }, now: Date): Omit<DeskSetupProps, 'frame' | 'on*'>` in `map.ts`. Also `useSetupTest(testId: string | undefined): { test: SetupTestDto | null; events: RunEventDto[] }` (EventSource on `setupTests.events`).
- Save sends `baseVersion` = the version the draft started from. A 409 shows `saveError` "Changed since you opened it. Reload to see the new version." and keeps the draft, the same way skills handle a stale sha. The editor rejects >65536 bytes with the contract's message before sending.

- [ ] **Step 1: Write failing tests:**
  - `map.test.ts`: phases from events (clone ✓ on `checkout`, plugins list, setup ✓/✗), `lastTest.matchesSaved`, empty state (`script: null` → starter text and the "No setup script: runs start the agent right after cloning" copy)
  - route test (MSW): loads and saves (v1 → v2), 409 keeps the draft and shows the error, Test → the panel goes `running` → `passed` from the stream, End test posts `end`, the terminal opens via `useTerminalSocket` at `/api/setup-tests/:id/terminal`, error state when the script GET fails
  - run detail maps `failureStage: 'setup'` → "Setup failed" and "setup version N"
  - contract test covers the new handlers
- [ ] **Step 2: Run `pnpm --filter @agentdesk/web test`.** Expected: FAIL.
- [ ] **Step 3: Implement** (design tokens only; existing components; no new shared component unless it gets a story).
- [ ] **Step 4: Run `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck && devbox run e2e-mock`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): wire Desk workspace setup tab`.

---

## Part F: PR 6, onboarding step and warnings

### Task 16: `setup` onboarding step and "warn, don't block"

**Files:**
- Modify: `packages/contracts/src/enums.ts` (`SetupStep = ['agent','setup','skills','rules','ready']`), `packages/db/src/schema/app.ts` + migration `0008_projects_setup_step_setup.sql` (drop and re-add `projects_setup_step_check` with `setup`), `apps/api/src/projects/projects.service.ts` (`STEP_ORDER`)
- Modify: `apps/web/src/features/setup/steps.ts` (`SETUP_STEPS = ['repo','agent','setup','skills','rules','ready']`), `apps/web/src/screens/setupSteps.ts` callers (`withWorkspace: true`), `apps/web/src/app/routes/o.$org.projects.new.$step.tsx` (render `SetupWorkspace` for `setup`, reusing Task 15's queries/mutations; Skip → `skills`), `apps/web/src/features/setup/resume.ts`, the Ready step and the Desk header warning (latest test failed, or no passing test matches the current script)
- Test: `apps/api/test/projects.test.ts`, `packages/db/test/migrate.test.ts`, `apps/web/src/features/setup/{resume.test.ts,setup.route.test.tsx}`, `apps/web/e2e/mock/setup.spec.ts`

**Interfaces:**
- Consumes: Task 15 hooks and `toDeskSetupProps`.
- Produces: forward-only `PATCH setupStep: 'setup'` from `agent`. Existing projects already past `agent` are unaffected.

- [ ] **Step 1: Write failing tests:**
  - api: `agent → setup → skills` accepted, `skills → setup` ignored (forward-only)
  - migration accepts `setup` and existing rows still validate
  - web: resume lands on `setup` for a project at that step, Skip goes to `skills` without saving, the stepper shows five steps
  - the Ready step shows the warning when the latest test failed, and `Go live` stays enabled
- [ ] **Step 2: Run the api, db and web tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `devbox run check`.** Report the real results (`format:check` may fail repo-wide for reasons unrelated to this change, per AGENTS.md). Then `devbox run e2e-local` against `devbox run dev`: create a project, save a script, Test passes with the fake pod, a run shows `setup version 1`, and a `--fake-setup-fail` script makes a run "Setup failed". Expected: all pass.
- [ ] **Step 5: Commit** `feat(web): prepare workspace onboarding step and warnings` (plus `feat(api)`/`feat(db)` commits for the enum and migration).

---

## Judgment calls (record in the PRs)

- **Setup output prefix** (`setup| `, `plugin| `). The spec did not call for one. It is needed so script output can never forge a marker (Review Focus 1).
- **The test draft is stored in `setup_tests.script_body` and cleared at end.** It is not passed in Temporal workflow input, so it does not linger in history. Only the hash outlives the test, which matches spec §5.3.
- **`failure_stage`:** `'setup'` for setup failures, `'agent'` for a non-zero agent exit, null otherwise (infra failures such as pod Pending are neither).
- **Setup test status** uses the spec's enum plus `ended_at` (workspace gone) and `finished_at` (result known). `ended` as a status means the test ended before it had a result.
- **The setup-test SSE polls every 1 s** instead of using LISTEN/NOTIFY.
- **Plugin selection exists twice** (runner `.mjs`, core `.ts`), because the image build context cannot import workspace TypeScript. One shared fixture file pins both.
- **The audit log stores `{ sha256, bytes }` for script bodies**, not the text.
