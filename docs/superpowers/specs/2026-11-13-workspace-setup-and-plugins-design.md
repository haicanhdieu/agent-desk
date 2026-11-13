# Workspace setup and plugins: design

Status: draft · 2026-11-13 · Amends control-plane spec §8 (runner contract).

## 1. Intent

A run pod today clones the repo and starts Claude Code straight away. Two things are missing between "clone" and "prompt":

1. **Plugins.** A repo can enable Claude Code plugins in `.claude/settings.json` (`enabledPlugins`, e.g. `superpowers@anthropic-plugin-directory`). Nothing in the pod registers the marketplace or installs the plugins, so the agent starts without them.
2. **Dev setup.** Most repos need preparation (`pnpm install`, codegen) before an agent can build or test. Users need to define that preparation from the web app, **try it in a throwaway workspace with a terminal**, and edit it again later, not only during onboarding.

Success: a project whose repo enables plugins from the approved store and has a working setup script gets runs whose agent sees those plugins and a prepared workspace, and the user verified the setup themselves before trusting it.

## 2. Goals, non-goals, anti-goals

Goals
- Every run (and every setup test) installs approved plugins the repo enables, then runs the repo's setup script, then starts the agent.
- Users edit the setup script in the web app during onboarding **and** later from project settings (Desk), with the same editor and Test button.
- Test = a throwaway workspace running the exact same steps as a real run, with live log and an attachable terminal.
- A failing setup in a real run stops before the agent starts, labelled distinctly from agent failures.

Non-goals (v1)
- Custom or per-project runner images; system packages, Docker, services (Postgres, browsers). The pod stays non-root, `capabilities: drop ALL`.
- Secrets/env vars for setup (private registries will fail in v1). → Follow-up F2.
- PR-based edits for protected branches. → Follow-up F1.
- Per-org plugin store allowlist. → Follow-up F3.
- Caching setup output between runs (Approach 3 below is a possible later speed-up).

Anti-goals (would be failures even if it "works")
- A repo can make the pod install plugins from any marketplace it names (repo text is untrusted: AGENTS rule 6).
- "Test passed" while real runs take a different path (different steps, different script).
- The agent starts in a half-prepared workspace after setup failed.
- Script content or repo-controlled values interpolated into shell, k8s specs or SQL.
- An unattended run hanging on an interactive Claude Code prompt (marketplace trust, plugin install).

## 3. Decisions (made with the user)

| # | Question | Decision |
|---|---|---|
| 1 | What kind of setup | **Setup script only** (commands a non-root user can run). Design so a menu of base images can be added later. |
| 2 | Plugins | **Auto-install what the repo enables, only from approved stores.** v1: approved = Anthropic's official store, platform-configured. The UI shows which plugins load and which were blocked. |
| 3 | Testing | **Throwaway test workspace with live log + terminal.** Available in onboarding **and** in project settings later. A failing last test **warns, does not block** going live. |
| 4 | Where the script lives | **Stored by Agent Desk** (Postgres, per project, versioned), **not in the repo**. Saving is instant; every save is a new version with author and time; any version can be restored. Every run records the version it used. (The user first chose "in the repo", then changed to this.) |
| 5 | How Save reaches the repo | **Moot** (the script is not in the repo). The PR-flow follow-up the user asked for stays, for Skills (F1). |
| 6 | Secrets | **None in v1.** |
| 7 | Setup fails in a real run | **Stop the run as "Setup failed"**, agent never starts, ticket comment links the log. Plugin install failure: continue with a warning. |
| 8 | Credentials visible to setup | **Accepted, recorded in the ADR.** Setup runs with the pod's existing env (clone token, `runEnv`, agent credential). Only Agent Desk users allowed to edit the project's setup can change the script, and they can already attach to run terminals where the same credentials are visible, so setup adds no new exposure. Hiding credentials from setup and the agent is follow-up F6. Test pods get no agent credential, but carry the write-scoped clone token and `runEnv` (`GH_TOKEN`), and the editor gets a shell with them for the test's TTL. |
| — | Build approach | **Approach 1** (phases in the existing entrypoint; test = same Job in test mode). |

## 4. Approaches considered

1. **Phases in the existing entrypoint (chosen).** `entrypoint.sh` becomes clone → plugins → setup → agent. A test is the same Job with `RUN_MODE=setup_test`: same phases, then an idle shell in tmux instead of Claude. Test and real runs share one code path, so a pass means something, and log streaming, terminal relay and Job lifecycle are reused. Cost: the entrypoint grows and needs careful tests.
2. **Init container for preparation.** Cleaner separation on paper, but a failed init container leaves nothing to attach a terminal to (breaks decision 3), and HOME/plugins must be shared across containers on a volume. Rejected.
3. **Pre-built per-project image.** Fastest runs, but it is the custom-image path ruled out by decision 1 (image builds, storage, rebuild triggers). Possible later optimisation.

## 5. Design

### 5.1 Runner entrypoint phases (`images/runner/entrypoint.sh`)

Order, same in both modes:

1. **Clone + checkout** (unchanged). In test mode the ref is the project's default branch.
2. **Plugins.**
   - Read `$REPO_DIR/.claude/settings.json` if present; parse with `node` (in the image), never `eval`/`source`. Take `enabledPlugins` keys whose value is `true`, of the form `<plugin>@<marketplace>`; validate each part against a strict slug regex; drop anything else.
   - Approved stores come from env `PLUGIN_MARKETPLACES` (JSON `{ "<name>": "<source>" }`, set by the worker from platform config, default the official Anthropic store). For each approved marketplace that has at least one enabled plugin: register it; then install each enabled plugin from it. Every value is passed as a separate argv element.
   - Approval is by marketplace **name**, but the entrypoint always registers an approved name from the **source in config**, never from a source the repo supplies. Plugins from unapproved marketplaces are skipped. Repo `extraKnownMarketplaces` is ignored for install purposes. Code the repo runs (the setup script, the agent's tools) is outside this guarantee (F6).
   - Default config (as built, [ADR 0019](../../adr/0019-repo-setup-and-approved-store-plugins.md) CLI spike): `RUN_PLUGIN_MARKETPLACES = {"claude-plugins-official": "anthropics/claude-plugins-official"}`. `anthropic-plugin-directory` is built in to the CLI and has no source, so it cannot be approved through `PLUGIN_MARKETPLACES`; a repo that enables `<plugin>@anthropic-plugin-directory` (as this repo's own `.claude/settings.json` does) sees that plugin skipped until it uses the `claude-plugins-official` id or a follow-up supports approving built-in store names.
   - Each install has a timeout. A failure logs a warning and continues (decision 7).
   - The run must not hit an interactive marketplace/plugin trust prompt. The builder must verify with the pinned Claude Code version (`CLAUDE_CODE_VERSION` in the Dockerfile) which CLI commands exist (`claude plugin marketplace add`, `claude plugin install`, or equivalent) and what user-level settings/state pre-accept them, and pin that in a test.
3. **Setup.**
   - Script source: env `SETUP_SCRIPT`, set by the worker as an env value (like `PROMPT`, never interpolated). Real runs: the project's current saved version. Tests: the editor draft. Unset or empty: skip. Nothing is read from the repo.
   - Runs as `bash <file>` (draft written to a temp file first) with cwd `$REPO_DIR`, under `timeout` (env `SETUP_TIMEOUT_SECONDS`, default 600). The file is never `source`d into the entrypoint's shell.
   - Output goes to stdout (so it lands in pod logs → `run_events`). Credentials are already redacted from stored output by the existing redaction.
   - Non-zero exit or timeout: real-run mode prints the failure marker and exits with the dedicated setup-failure exit code without starting Claude.
4. **Agent** (real run, unchanged): tmux session `agent` running Claude.
   **Idle shell** (test mode): tmux session `agent` running `bash -l` in `$REPO_DIR`, so the existing terminal relay (`tmux attach -t agent`) works unchanged. Started whether setup passed or failed, so the user can debug. The pod lives until the test's lifetime ends (§5.3) or the user ends it.

New stdout markers (exact strings fixed by the builder, added to the runner contract):
`agentdesk: plugins begin`, `agentdesk: plugin installed <id>`, `agentdesk: plugin skipped <id> (store not approved)`, `agentdesk: plugin failed <id>`, `agentdesk: plugins end`, `agentdesk: setup begin`, `agentdesk: setup skipped (no script)`, `agentdesk: setup passed`, `agentdesk: setup failed exit=<n>` / `agentdesk: setup timed out`. The existing `agentdesk: session started` still marks the agent (or idle shell) start.

### 5.2 Real runs (worker)

- `buildRunJob` adds env `PLUGIN_MARKETPLACES`, `SETUP_TIMEOUT_SECONDS` (from config, never from repo text) and `SETUP_SCRIPT` (the project's current saved version, read when the Job is created). The run row records `setup_script_version` (nullable: no script).
- Run status: the run stays `starting` through plugins and setup; `followPodLogs` must not flip it to `running` on setup output. Only `agentdesk: session started` (or the first line after it) does. Plugin and setup lines are stored as run events so the run page shows them.
- On the setup-failure marker/exit code, the run finishes `failed` with a **failure stage = setup**, stored structurally (e.g. new nullable `runs.failure_stage` column, `'setup' | 'agent'`; builder may choose the exact shape). The run page and run list label it "Setup failed" and link to the project's Setup tab. The ticket finish comment says setup failed and links the run.
- Setup time counts within the run's existing `timeout_seconds`.

### 5.3 Setup tests

- **Model.** A separate entity, not a row in `runs` (runs carry ticket fields, numbering, slots, rules and counts that do not apply). Suggested: table `setup_tests` (org-scoped, RLS via `orgPolicy`, `withOrg`): `id, org_id, project_id, status (queued|running|passed|failed|ended), script_sha256, checkout_sha, plugins jsonb (installed/skipped/failed ids), exit_code, started_by, created_at, finished_at`. A test runs the editor draft, which may be unsaved; the draft reaches the pod as an env value and only its hash is kept on the test, so the UI can say whether the last test matches the current saved version.
- **Lifecycle.** A small Temporal workflow (`SetupTestWorkflow`) creates the Job (via `KubeGateway`, labelled distinctly, e.g. `agentdesk/kind=setup-test`), follows logs, records the result at `agentdesk: session started` (or when the log ends) from the last `setup passed/failed/timed out/skipped` marker seen, then keeps the pod alive for **15 minutes** (or until "End test"), then deletes it. A test that reaches no result (the pod died first) is ended at once, with no TTL wait. Test pods share the run namespace's `ResourceQuota` (ADR 0019, negative consequences). One active test per project: starting a new test ends the previous one. Tests do not consume the project's run slots.
- **Credentials in the test pod:** clone token and `runEnv` (same as runs), **no agent credential** (Claude is not started).
- **API** (contracts first, `packages/contracts`):
  - `POST /api/projects/:projectId/setup-tests` body `{ script: string }` (max 64 KiB) → `SetupTestDto`
  - `GET /api/projects/:projectId/setup-tests/latest` → `SetupTestDto | null`
  - `GET /api/setup-tests/:id/events` (SSE, same shape as run events)
  - `POST /api/setup-tests/:id/end`
  - `GET /api/setup-tests/:id/terminal` (WebSocket, same relay and close codes as runs)
- **Authz** on all of them, including terminal: same rule as run terminal attach (org member and project creator or org owner).

### 5.4 Saving the script

- Storage: table `setup_script_versions` (org-scoped, RLS, `withOrg`): `id, org_id, project_id, version int (per project, increasing), body text (max 64 KiB), note text null, created_by, created_at`, unique `(project_id, version)`. The current script is the highest version. An empty body means "no setup". Restoring version N writes a new version with N's body (history is append-only).
- The script is configuration, not a secret. The editor says "don't put passwords or tokens here" (secrets are F2). Script text is redacted from logs like any run output, and never logged by the api.
- API (contracts first):
  - `GET /api/projects/:projectId/setup-script` → `{ version, body, note, createdBy, createdAt } | null`
  - `PUT /api/projects/:projectId/setup-script` `{ body, note?, baseVersion }` → the new version. 409 if `baseVersion` is not current ("changed since you opened it", same UX as Skills' sha conflict).
  - `GET /api/projects/:projectId/setup-script/versions` → list (no bodies); `GET …/versions/:version` → one with body.
- Authz: read for org members of the project; write and test for the project creator or an org owner (same rule as terminal attach). Writes go to `audit_log`.

### 5.5 Web app

- **Desk tab "Setup"** (`/o/$org/p/$project/desk/setup`), next to Agent / Skills / Rules: script editor, optional change note, Save, version history (who, when, note; view; restore), the run page shows "setup version N", **Test** (runs the editor draft), test panel (live log, phase checklist: clone ✓, plugins (installed/skipped/failed list), setup ✓/✗), **Open terminal** (existing terminal component), **End test**, and "Last test: passed/failed · matches current script / script changed since".
- **Plugins panel** on the same tab: plugins the repo enables, each marked "will install" or "blocked: store not approved". Derived from the repo's `.claude/settings.json` (read via adapter) and the platform allowlist (exposed by the API).
- **Onboarding:** new skippable step `setup` with the same component. Builder call on placement; proposed order `repo → agent → setup → skills → rules → ready`. Requires `SetupStep` enum, the `projects_setup_step_check` constraint (new migration), and `SETUP_STEPS` in the web app.
- **Warn, don't block:** the Ready step and the Desk header show a warning if the latest test failed or the script changed since the last passing test.
- Loading, empty ("No setup script: runs start the agent right after cloning"), and error states; stories for every new shared component; design tokens only.

### 5.6 Config

Platform config (infra chart supplies): `RUN_PLUGIN_MARKETPLACES` (JSON name→source, default official store), `RUN_SETUP_TIMEOUT_SECONDS` (default 600), `SETUP_TEST_TTL_SECONDS` (default 900). Pod egress must reach the plugin marketplace sources and package registries; the infra NetworkPolicy must allow it (flag to infra spec).

## 6. Constraints

- AGENTS rules apply, notably: contracts first; layering; provider-agnostic names; `withOrg`; no secrets in Postgres/logs; untrusted repo/script text only as env values or files, never interpolated; authz on every endpoint including terminal; new migrations only; bug fixes start with failing tests; no network in tests.
- Sensitive paths needing human review: runner image/entrypoint, Job spec, terminal relay, migrations.
- Docs: amend control-plane spec §8 (runner contract) in the same change; add an ADR for "repo-defined setup and approved-store plugin install in the run entrypoint".
- PRs around 400 lines, one concern each. A sensible slice order: (1) entrypoint plugins + contract doc + ADR; (2) setup-script storage (db, contracts, API); (3) entrypoint setup phase + `SETUP_SCRIPT` + failure stage in worker; (4) setup tests (db, workflow, API, terminal); (5) Desk Setup tab; (6) onboarding step + warnings.

## 7. Follow-ups (out of scope, tracked)

- **F1. PR flow for repo edits (Skills):** open a PR when a direct commit is refused or the user prefers it; show PR status in the app; approve and merge from Agent Desk.
- **F2. Project environment variables / secrets** for setup and agent: stored in the SecretStore (Kubernetes Secrets), masked in UI, redacted in output, visible to the agent.
- **F3. Per-org approved plugin stores** (including private marketplaces).
- **F4. Base image menu** (Node, Python, Node + browser) underneath the setup script.
- **F5. Setup caching / pre-built workspaces** to speed up runs.
- **F6. Hide credentials from setup and the agent** (clean env for setup, agent credential via a file only the agent step reads, short-lived or read-only tokens).
- **F7. Per-branch setup** if teams need different setup per branch (v1 has one script per project).

## 8. Left to the builder

Exact marker strings and exit code; exact CLI commands and pre-acceptance state for plugin install on the pinned Claude Code version; `failure_stage` shape; `setup_tests` columns; whether test workflow reuses run activities or gets its own; onboarding step placement (proposal above); UI layout within the design system.
