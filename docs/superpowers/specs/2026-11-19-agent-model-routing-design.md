<!-- dev-plan: kind=spec id=agent-model-routing rev=2 hash=cd2506f36e26 source=issue#122 -->
# Agent models, custom API address and per-rule model — design

Date: 2026-11-19 · Status: draft for approval · Sensitive: yes (migration; run Job and runner entrypoint; agent
credential handling: the API now reads the stored credential and sends it to the configured address)

## Intent

Today the model is effectively fixed. On **Desk → Agent** the Model dropdown shows only the saved value and can't be
changed; new projects start on `sonnet`. The setup wizard offers a hardcoded `opus` / `sonnet`. There is no way to point
an agent at a gateway or another Anthropic-compatible API. In **Routing Rules** the "With agent" field shows the
agent's model next to its name ("Claude (opus)"), so a rule can't choose its own model.

The human wants:

- the models an agent supports, loaded from the agent's provider, plus a model name typed by hand when it isn't
  listed, kept exactly as typed;
- a custom API address per agent, set the way that agent actually reads it (for Claude Code, `ANTHROPIC_BASE_URL`),
  never forcing one protocol on every agent;
- a routing rule that names its agent and its model separately;
- every run launched with exactly that agent, model and address, with nothing in the runtime swapping the model.

Words used here (the human's terms): an agent has a **default model**, set while setting up the agent or on Desk →
Agent. A rule either **follows the default model** (it names none) or **names its own model**. Changing the default
model changes it for every rule that doesn't name one.

## Goals

1. **Model list.** On Desk → Agent, in the setup wizard's Agent step and in the rule form, the model options are
   loaded live from the selected agent's provider, using the saved credential and the saved address.
2. **Fallback.** When the live list can't be loaded (no credential yet, provider unreachable, credential rejected, no
   list endpoint on the gateway), the options fall back to the agent's built-in names. For Claude Code those are
   `opus`, `sonnet` and `haiku`. A short note says why.
3. **Typed model.** The user can always type a model name by hand. It is stored and passed to the agent exactly as
   typed (after trimming surrounding spaces).
4. **API address.** The agent has an optional API address (empty means the provider's default). For Claude Code it
   reaches the run as `ANTHROPIC_BASE_URL`. Only public `https` addresses are accepted.
5. **Address change needs the credential again** (human decision, batch 2). Changing or clearing the address drops
   the saved credential, and the same save must carry a new one.
6. **Per-rule model.** A rule stores its agent and its model as separate values. The model is optional; empty means
   "follow the default model".
7. **Exact launch.** A run is started with the agent kind, the model and the address it was configured with. The
   runtime can't silently replace the model: the run's model is passed on the agent's command line, which beats
   repo settings.
8. **Open to more agents** (human decision, batch 1). Claude Code is the only agent now. Everything agent-specific
   (model list, built-in names, address setting, credential env names, launch flags) sits behind one agent adapter, so
   adding an agent later means adding an adapter, a runner command file and that agent's CLI in the image, with no
   rework of contracts, tables, worker or UI.
9. **Prototype first** (human decision, batch 2). The UI changes are drawn in the prototype boards first, and the
   human reviews and approves them before any UI code is written (see "Prototype gate").

## Non-goals

- Adding Codex, Aider or any agent other than Claude Code (human, batch 1: "only claude for now").
- Reaching gateways on private, LAN or in-cluster addresses. The run pod NetworkPolicy stays as it is (human, batch 1,
  Q4 option 1).

## Anti-goals

- Forcing an OpenAI-compatible address (or any single env var) on every agent (from the requirement).
- The runtime quietly running a model other than the one configured: no silent fallback to the CLI default when a
  model was set.
- A stored credential ever paired with an address it wasn't saved with (the reason for goal 5).
- Secret values in Postgres, logs, events, errors, audit rows or literal Job env (AGENTS.md rule 5).

## Constraints

- AGENTS.md rules 1–11: contracts first; layering `apps → core → db → contracts`, `web → contracts` only;
  provider-agnostic names in tables, types, modules and routes; `withOrg` on every query; secrets by name only; authz
  on every endpoint; a new migration instead of editing an applied one; bug fixes start with a failing test; no network
  in tests; design tokens, stories and loading/empty/error states; strict TS with Zod at boundaries.
- Run pod egress: DNS plus public internet only. `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` and
  `169.254.0.0/16` are blocked (security.md §4). A gateway must therefore be publicly reachable.
- The UI copy comes from the prototype. New copy goes into the boards first (frontend.md §8: "MUST NOT rewrite UI copy
  taken from the prototype in the same PR as a code change").
- PRs stay around 800 lines, one concern each (git-workflow.md).

## Approaches

### Where the model list comes from (human picked 1)

| | Approach | Trade-off |
|---|---|---|
| **1 (picked)** | Live from the provider's model list endpoint, called by the API with the saved credential and address. Built-in names when that fails. Typing by hand always works. | Matches "load dynamically" and works with gateways that have no list. Adds an outbound call from the API that carries the credential, which needs an SSRF guard. |
| 2 | Built-in list per agent, updated in code, plus typing by hand. | No outbound call, but it goes stale and can't show a gateway's own models. |
| 3 | Live only. | Breaks on every gateway without a list endpoint and before a credential is saved. |

### Where the per-agent knowledge lives (Agent call)

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | An agent adapter in `packages/core` (beside the code-host and board adapters), looked up by agent kind. The API uses it to list models; the worker uses it to build the Job env. The runner picks a command file by kind, as it already does with `AGENT`. | One place per agent; adding an agent touches no contract shape or table. |
| B | Agent-specific `if`s in the API, worker and web. | Fastest today, but it is exactly the rework the human wants to avoid. |
| C | The browser calls the provider's list directly. | Would hand the credential to the browser. Rejected (security.md §1). |

Agent call: approach A, because the human asked for "open design so we can add more agent without rework" and the
repo already has the adapter-and-registry pattern (ADR 0005).

### How an address change protects the credential (human picked 1)

| | Approach | Trade-off |
|---|---|---|
| **1 (picked)** | Changing the address drops the saved credential; the same save must include a new one. | Whoever moves the address has to supply the key. Changing the address is rare. |
| 2 | Allow it as an accepted risk until roles exist. | No work, but any member could redirect the key to their own server. |
| 3 | Only org owners can change the address. | Needs a role check the app doesn't have yet. |

## Design

### Agent adapter (`packages/core`)

New module `packages/core/src/adapters/agents/`, with `types.ts`, `claude.ts` and a registry (`agentAdapterFor(kind)`),
following the existing `adapters/registry.ts` pattern.

```ts
interface AgentAdapter {
  kind: AgentKind;                                  // 'claude'
  builtinModels: readonly AgentModelOption[];       // claude: opus, sonnet, haiku
  /** Env name for each credential type, e.g. oauth_token → CLAUDE_CODE_OAUTH_TOKEN, api_key → ANTHROPIC_API_KEY. */
  credentialEnv(type: CredentialType): string;
  /** Literal env values for the Job: model and address, in this agent's own form. */
  launchEnv(input: { model: string; baseUrl: string | null }): { name: string; value: string }[];
  /** Live model list; throws a typed AgentModelsError ('unreachable' | 'rejected' | 'invalid') on failure. */
  listModels(input: { credential: { type: CredentialType; value: string }; baseUrl: string | null }): Promise<AgentModelOption[]>;
}
```

- `CREDENTIAL_ENV` moves from `apps/worker/src/activities/run.activities.impl.ts` into the Claude adapter.
- **Claude `launchEnv`:** `AGENT=claude` and `AGENT_MODEL=<model>` (generic names the runner reads), `ANTHROPIC_MODEL=<model>`
  (kept, as today), and `ANTHROPIC_BASE_URL=<address>` only when an address is set.
- **Claude `listModels`:** `GET <base>/v1/models?limit=1000`, where `<base>` is the address or
  `https://api.anthropic.com`, appending to any path the address has (Claude Code's own `ANTHROPIC_BASE_URL` rule).
  - Headers: `anthropic-version: 2023-06-01`. An `api_key` goes in `x-api-key`. An `oauth_token` goes as
    `Authorization: Bearer` plus `anthropic-beta: oauth-2025-04-20`.
  - Follows `has_more` / `last_id` for at most 5 pages. Parses only `data[].id` and an optional `data[].display_name`
    with Zod, which also accepts the OpenAI-style `{ data: [{ id }] }` most gateways return.
  - Keeps the provider's order and drops duplicates.
- **HTTP transport.** The transport is `undici`, already a dependency of `packages/core`. Calls run through an undici
  `Agent` whose `connect.lookup` refuses any resolved address in loopback, link-local, private, CGNAT or
  unspecified ranges, IPv4 and IPv6. That covers the NetworkPolicy's list plus `127.0.0.0/8`, `0.0.0.0/8`, `::1`,
  `fc00::/7` and `fe80::/10`. Checking at connect time also defeats DNS rebinding.
  - Other limits: no redirects, a 5 s total timeout, a 1 MB body cap.
  - The fetch is injectable, so tests use undici `MockAgent` and never touch the network.
- Errors never carry the upstream body, the credential or request headers. Logs name the error class and the
  address's host only.
- Agent call: 5 pages and 5 s, because a model list is small and a slow gateway must not hang the form.
- Agent call: built-in Claude names are exactly the three Claude Code aliases `opus`, `sonnet` and `haiku`, because
  Claude Code accepts them on every account and gateway setup.

### Contracts (`packages/contracts`)

- **`enums.ts`:** `AgentKind = z.enum(['claude'])`. `AgentDto.provider` changes from `z.literal('claude')` to
  `AgentKind`. The wire value is the same, and adding an agent means adding an enum value.
- **`AgentModelId`:** a trimmed string, 1–200 characters, `^[A-Za-z0-9][A-Za-z0-9._:/@\[\]+-]*$`. That allows aliases
  (`opus`), dated ids, `sonnet[1m]`, cloud ARNs and `vendor/model` gateway names. It rejects spaces and control
  characters.
  - Agent call: this pattern, because the value travels only as an env value and a quoted argv element, but a bounded
    alphabet keeps logs and the UI sane.
  - Existing stored values (`sonnet`, `opus`) pass it.
- **`AgentBaseUrl`:** an absolute `https:` URL, at most 2048 characters, with no username/password, query or fragment.
  Hostnames `localhost` and `*.localhost` are rejected, and so are IP-literal hosts in the blocked ranges. The resolved
  address is checked again at fetch time (above).
- **`AgentDto`:**
  - gains `baseUrl: string | null`;
  - `model` keeps its name and now documents "the default model".
  - Agent call: the field and the `agents.model` column are not renamed, because AGENTS.md forbids renaming public
    names and the UI label carries the new term.
- **`PutAgentRequest`:**
  - `model` becomes `AgentModelId`;
  - it has **no** `baseUrl` field, so the address can't change without a credential.
- **`PutCredentialRequest`:**
  - gains `baseUrl?: AgentBaseUrl | null`. Absent keeps the address; a value sets it; `null` clears it back to the
    provider default.
  - Because this route always replaces the credential, "a new address comes with a new credential" holds by
    construction.
  - Agent call: the address is changed only through the credential route, because it keeps the secret and its address
    in one write-only call that is already audited with redaction.
- **New `AgentModelsDto`:** `{ source: 'live' | 'builtin', reason: null | 'no_credential' | 'unreachable' | 'rejected' | 'empty' | 'disabled', models: { id: string, label: string }[] }`.
- **New route `agents.models`:** `GET /api/agents/:agentId/models` returns `AgentModelsDto`.
  - Agent call: keyed by agent id (like `putCredential`), not project, so a rule form can load the list for whichever
    agent the rule picks once a project has more than one.
- **`RuleDto`:** gains `model: string | null` (null means it follows the default model).
- **`CreateRuleRequest`** (both kinds) gains `agentId?: Id` and `model?: AgentModelId | null`. **`UpdateRuleRequest`**
  gains `agentId?: Id` and `model?: AgentModelId | null` (`null` resets to the default model).
  - Agent call: `agentId` is optional on create and defaults to the project's agent, so today's single-agent clients
    keep working and a second agent needs no contract change.
- **`RunDto`:** no shape change. `agent.model` now reports the run's own model (see API).

### Database (`packages/db`), one new migration (`0017_…`)

- **`agents`:**
  - add `base_url text null`;
  - add check `base_url is null or (base_url like 'https://%' and char_length(base_url) <= 2048)`.
  - The existing `provider` column (default `'claude'`) is the agent kind; it is not renamed.
- **`rules`:**
  - add `model text null`;
  - add check `model is null or char_length(model) between 1 and 200`.
- **`runs`:** add `model text null`. It is copied at intake and null on runs queued before this change.
- No backfill. Every query stays under `withOrg`; RLS policies are unchanged (new columns on existing tables).

### Routing and intake (`packages/core`)

- `RuleRow` (in `router/route-event.ts`) gains `model`.
- `intake/process-ticket-event.ts` writes `runs.model = rule.model ?? <default model of rule.agentId>`, read in the same
  transaction.
- Agent call: the model is frozen on the run at intake, like the custom prompt. A run then keeps one model for its
  whole life, a resume uses the same model, and Run detail shows the model actually used. A run already queued when
  the default model changes keeps the model it was queued with.

### Worker (`apps/worker`)

- `details()` selects `runs.model` and `agents.base_url`, with `agents.provider` as the kind. The model is
  `runs.model ?? agents.model ?? ''`; the fallback covers runs queued before this change.
- `createRunSecretAndJob` uses the adapter: `credentialEnv(type)` for the run Secret keys and `launchEnv({ model, baseUrl })`
  for the literal env, passed to `buildRunJob` as `agentEnv` (replacing the `model` field).
- Agent call: the address and credential are read from the agent each time a pod starts, including on resume, while
  the model comes from the run. The address and key are connection settings that can be fixed for a paused run; the
  model is the run's choice.
- **`buildRunJob` (`packages/core/src/kube/job-spec.ts`):** adds the adapter's env entries as literal values. They hold
  no secret: the address is rejected if it has credentials in it. Everything else in the Job is unchanged.

### Runner (`images/runner`)

- **`agents/claude/commands.sh`:** the start and resume commands add `${AGENT_MODEL:+--model "$AGENT_MODEL"}`. The
  value is expanded only as one quoted argument, never evaluated, as security.md §5 requires.
  - Agent call: `--model` on the command line, because in Claude Code it outranks `ANTHROPIC_MODEL` and any `model`
    key in a repo's `.claude/settings.json`. That is the "no silent replacement" guarantee.
- **`entrypoint.sh`:** before launching, it prints one line, `agentdesk: agent <kind> model <model> endpoint <origin|default>`,
  with `printf '%s'`-style quoting. Pod output is already redacted on storage.
- **Fake pod (`packages/core/src/kube/fake-pod.mjs`):** prints the same line from its env, so local e2e can see what a
  run was started with.
- Agent call: the builder checks with the pinned Claude Code version (runner test) whether a repo's
  `.claude/settings.json` `env` block can override `ANTHROPIC_BASE_URL`. If it can, the PR records it as a known risk
  in security.md and does not fix it here. That exposure exists today without this change, and fixing it needs the
  planned egress proxy.

### API (`apps/api`)

- **`agents.service`:**
  - `toDto` maps `provider` through `AgentKind` and adds `baseUrl`;
  - `put` validates `model` with `AgentModelId`.
- **`putCredential` with `baseUrl` present:** the address is changing. Invariant: at no moment is a stored credential
  paired with an address it wasn't saved with. Order:
  1. In one transaction, set `base_url` and clear the credential metadata (`credential_secret_name`, `_type`,
     `_updated_at`, `_set_by`).
  2. Delete the old Secret.
  3. Write the new Secret.
  4. Set the metadata again.
  - If step 3 fails, the agent is left with the new address and no credential. That is safe: runs refuse to start
    and the UI shows "not set".
  - Without `baseUrl`, the route behaves as today.
- **`models` handler:**
  - Authorized like `putCredential`: session and org through `withOrg`, the agent must exist in the org, and the same
    project-access check the project routes use.
  - Reads the credential through the existing `SecretStore.get`.
  - Returns `{ source: 'builtin', reason }` when there is no credential, the adapter throws, the live list is empty, or
    config turns live lists off. Otherwise it returns `{ source: 'live', reason: null }`.
  - Upstream failures are never a 5xx and never echo upstream text.
- **`rules.service`:**
  - create and update accept `agentId`, which must be an agent of the same project; otherwise 422 on `/agentId`;
  - create and update accept `model`;
  - `RuleDto` returns `model`.
- **`runs.service`:** `agent.model = run.model ?? agent.model ?? 'unknown'`.
- **Config (`packages/core/src/config.ts`):** new `AGENT_MODELS_SOURCE: 'live' | 'builtin'`, default `live`.
  `.env.example` and the e2e env set `builtin`.
  - Agent call: this switch exists so the local stack and e2e never call the internet (AGENTS.md rule 9). The live
    path is proven by core unit tests with `MockAgent`.
- **Audit:** `putCredential` bodies already drop `value`. The address is not secret and stays in the audit row.
- Deployment check for the builder: the API's Kubernetes role must be allowed to `get` Secrets in the app namespace
  (today it writes them). The chart lives outside this repo, so if the role is missing, say so in the PR as an infra
  follow-up.

### Web (`apps/web`)

All of this follows the boards the human approves (Prototype gate, below); the copy below is a draft for the boards.

- **New shared component `ModelPicker`** (`apps/web/src/components/`), built from existing `ds` primitives (`Select`,
  `TextInput`, `Field`); no new UI library.
  - Props: `models`, `value`, `onChange`, an optional leading "Default model (x)" option standing for `null` (rule form
    only), and `state: 'loading' | 'ready' | 'fallback' | 'error'` with the fallback reason.
  - Its last option is "Other model…", which shows a text input. A saved value that isn't in the list shows as
    selected under that option.
  - It has a story for each state: loading, live list, fallback (each reason), error, typed model, long id.
  - Agent call: a select plus "Other model…" input instead of a combobox, because `ds` has no combobox and adding one
    (or a library) is out of proportion.
- **Queries:** `deskQueries.agentModels(org, agentId)` with a 5-minute `staleTime`. It is invalidated after a
  credential or address save. MSW handler and fixtures cover every `AgentModelsDto` shape.
- **Desk → Agent (`screens/DeskAgent.tsx`, route `desk.agent`):**
  - the Model field becomes "Default model" with `ModelPicker`;
  - a **Save agent** button saves the default model through `agents.put`, sending the other agent fields from a fresh
    fetch, as `useSaveLimits` already does;
  - a new **API address** field sits beside the credential. Editing it switches the credential to its "replacing"
    state with a note that the credential is needed again. One save sends `putCredential` with `{ type, value, baseUrl }`.
- **Setup wizard Agent step (`screens/Setup2.tsx`, route `projects.new.$step`):**
  - the hardcoded `MODELS` list is replaced by `ModelPicker`, with the same API address field;
  - changing the address when a credential is already set needs a new token; otherwise field error "Paste the token
    again to change the API address."
- **Rule form (`components/RuleForm.tsx`), used by Desk Routing Rules and setup step 4:**
  - "With agent" lists the project's agents by name only (the "(opus)" suffix goes);
  - a new **Model** field (`ModelPicker` with the "Default model (x)" option) loads the selected agent's models;
  - picking another agent reloads the list and keeps a typed or named model.
  - `RuleDraft`, `rules.form.ts` field maps and `changedFields` handle `agentId` and `model`, with the problem pointer
    `/model` → Model field.
- Agent call: the rule sentence, the rules list rows, run rows and SetupReady are unchanged, because the requirement
  doesn't ask for them. Run views already show the model through `ModelTag`, which now reports the run's model.

### Prototype gate

The repo's prototype is the set of `.dc.html` boards in `design/prototype/project/`, listed in `canvas.json`.
Storybook screen stories mirror them one to one (`screens/storyIds.ts`), and `apps/web/scripts/parity.mjs` compares
them (frontend.md §7–8, [storybook-and-parity.md](../../runbooks/storybook-and-parity.md)). As with the rule custom
prompt work (PR #56), the boards change first, in a `docs(design)` commit.

Boards to update:

- **`DeskAgent.dc.html`:** "Default model" picker with the live list; the "API address" field; the Save agent button.
- **`Setup2.dc.html`:** the same picker and API address field in the setup Agent step.
- **`DeskRules.dc.html`, `DeskRulesPrompt.dc.html`, `DeskRulesPromptNew.dc.html`, `DeskRulesPromptError.dc.html`,
  `Setup4.dc.html`:** the rule form's "With agent" without the model suffix, plus the new Model field.

New boards:

- **`DeskAgentCustomModel`:** "Other model…" chosen with a typed model, and the fallback note ("Showing the standard
  names…").
- **`DeskAgentAddressChanged`:** the address edited, and the credential in replacing state with the "needed again" note.
- Each new board is added to `canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together
  (`coverage.test.ts`).

**Gate.** The human reviews the updated and new boards and approves them in writing before any task that changes
`apps/web/src/{ds,components,screens}` or a web route starts. Contracts, db, core, worker, runner and API work does not
wait for it. After approval, parity drift is fixed or recorded in `design/parity-notes.md` as usual.

- Agent call: two new boards, because the typed-model and address-changed states are the two that look different
  from the default board.

### ADR and docs

- Agent call: a new ADR `0026-agent-adapters-for-models-and-endpoint.md`. AGENTS.md requires an ADR for an
  architectural choice, and the adapter seam plus an outbound API call that carries the credential are both
  architectural.
- **security.md:**
  - §1: the API reads the agent credential only to list models and sends it only to the agent's address; an address
    change replaces the credential;
  - §8: an agent adapter is a change that needs security review.
- **Architecture doc:** its "Agent abstraction" row points to the adapter. These are doc edits in the same PRs.

### Testing

- **Unit:**
  - the `AgentModelId` and `AgentBaseUrl` schemas (userinfo, query, private IP literal, `http:`);
  - the Claude adapter: headers per credential type, pagination, gateway-shaped body, each error class, a refused
    private address, redirect refused, timeout — all with `MockAgent`;
  - `launchEnv`; `buildRunJob` env (no `ANTHROPIC_BASE_URL` without an address; a model is always set);
  - the intake copy (rule model wins, otherwise the default model);
  - `ModelPicker` states; `rules.form` maps.
- **Integration:**
  - migration checks;
  - `putCredential` with `baseUrl` (ordering; a failed Secret write leaves no credential);
  - `models` authz (other org → 404) and every fallback reason;
  - rules with `agentId` from another project → 422;
  - worker resume uses the run's model.
- **Runner test (`images/runner/test`):** start and resume pass `--model` with the exact value (one argv element, even
  with `[1m]`), and none when `AGENT_MODEL` is empty.
- **E2E**, per AGENTS.md:
  - mock Playwright for the Desk → Agent picker, typed model, address change and rule Model field;
  - local Playwright for a rule naming its own model, then a rule following the default model after the default is
    changed. Run detail shows the expected model, and the pod log shows the `agentdesk: agent … model … endpoint …`
    line.
- The e2e section itself is a later gate of the planning flow.

## Left to the builder

- Exact copy, once the boards are approved, and exact file names inside the new adapter folder.
- PR split. A sensible order, each PR around 800 lines:
  1. prototype boards (gate);
  2. contracts, db and core;
  3. API;
  4. worker and runner;
  5. web.
- Whether `ModelPicker` labels show `display_name` with the id in mono, or the id only, as long as the stored value is
  always the id.

## Needs approval

None. Everything here uses dependencies the repo already has:

- `undici` (already in `packages/core`) for the model-list call and `MockAgent` in tests;
- Zod;
- existing `ds` primitives for the picker;
- the existing Claude Code CLI in the runner image.

## E2E requirements

These rules are requirements. Each is what a user can see at the UI (Desk → Agent & settings, the setup wizard's Agent step and step 4, the rule form on Desk → Routing rules, and Run detail / the run's terminal); the feature is done when every case below passes as an e2e spec. Derived from this spec and the frontend design (§4.3, §4.5, §6), security.md §1, frontend.md, the rule custom prompt design and the human's prototype boards, not from the code.

Local e2e runs with live model lists turned off, so cases that need a live list are `mock` (mocked list response) and local cases use the fallback list `opus`, `sonnet`, `haiku` (reason "disabled"). Duplicates and the five-page cap of BR-10, and a run that is still queued when the default model changes (BR-33), are proved at core unit level (mock agent, intake test); no screen can feed the provider's pages or hold a run queued.

### Rules

| Id    | Category            | Rule                                                                                                                                                                                                                                                                                                                  | Source                                                                         |
| ----- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| BR-1  | conditional-display | When a member opens Desk → Agent & settings for an agent whose saved credential and address let the provider return a model list, the "Default model" dropdown lists those models in the provider's order, then a last option "Other model…", with the note "Loaded from the provider. Rules that don't name a model use this one." | spec Goals 1, Web; DeskAgent board                                             |
| BR-2  | feedback-state      | When the model list can't be loaded on Desk → Agent (no credential saved, provider unreachable, credential rejected, empty list, or live lists turned off), the member sees the dropdown with `opus`, `sonnet`, `haiku` and "Other model…" and a short note saying why, instead of an error. | spec Goal 2, Design API `models` handler; DeskAgentCustomModel board          |
| BR-3  | feedback-state      | When the fallback note names a custom API address, the member sees only that address's host in it (e.g. "Showing the standard names. The model list at gateway.harbor-labs.com could not be loaded.") and never the credential or any text the provider returned. | spec Anti-goals, Design Adapter (errors); DeskAgentCustomModel board           |
| BR-4  | state-transition    | When a member picks "Other model…" on Desk → Agent, a text input appears, with the note "Sent to Claude Code exactly as typed. Rules that don't name a model use this one."; picking a listed model hides the input again.                                                         | spec Goal 3; DeskAgentCustomModel board                                        |
| BR-5  | conditional-display | When the saved default model is not in the dropdown's list (e.g. a typed name, or `sonnet` while the live list has only dated ids), the member sees "Other model…" selected with that value in the text input.                                                                                              | spec Web ModelPicker                                                           |
| BR-6  | persistence         | When a member picks a listed model, or types a model name (surrounding spaces trimmed, characters kept exactly, e.g. `sonnet[1m]`, `vendor/model`), and clicks **Save agent**, the saved default model is that id/text exactly, and after a reload Desk → Agent shows it. | spec Goal 3, Contracts AgentModelId, Web Desk → Agent; DeskAgent board         |
| BR-7  | validation          | When a member saves a default model that is empty, longer than 200 characters, contains a space or control character inside, or does not start with a letter or digit, the member sees a field error on the Model field and the default model is not changed.                                                | spec Contracts AgentModelId                                                    |
| BR-8  | side-effect         | When a member clicks **Save agent** after another session changed the run limits, the saved limits are not reverted: only the default model changes.                                                                                                                                                       | spec Web Desk → Agent (sends other fields from a fresh fetch)                  |
| BR-9  | feedback-state      | While the model list is loading, and when the list request itself fails, the picker shows its loading and error states, and the member can still choose "Other model…" and type a name.                                                                                                                       | spec Goal 3, Web ModelPicker states; frontend-design §6                        |
| BR-10 | limit               | When the provider's list has duplicates or more than five pages, the dropdown shows each model once, in the provider's order, and only the models from the first five pages.                                                                                                                                  | spec Design Adapter `listModels` (order, duplicates, 5 pages)                  |
| BR-11 | persistence         | When a member leaves the API address empty and saves the credential, runs use the provider's default address and, after a reload, the API address field is empty with "Optional. Leave empty for Anthropic's default."                                                                                       | spec Goal 4; DeskAgent board                                                   |
| BR-12 | validation          | When a member enters an API address that is not `https`, has a username or password, a query or a fragment, is longer than 2048 characters, or is `localhost`, `*.localhost` or an IP address in a private, loopback, link-local, carrier-grade or unspecified range, the member sees a field error and nothing is saved; a public `https` address is accepted. | spec Goal 4, Contracts AgentBaseUrl, Non-goals                                 |
| BR-13 | state-transition    | When a member edits the API address on Desk → Agent, the credential section changes to its replacing state ("Replaced when you save", "Credential needed again", "The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.") and the address note reads "Changed from Anthropic's default. It is saved together with the new credential below." | spec Goal 5, Web Desk → Agent; DeskAgentAddressChanged board                   |
| BR-14 | persistence         | When a member changes the API address (to another address, or cleared to empty) and pastes a new credential and clicks **Test and replace**, the new address and the new credential are saved together; after a reload the address field shows the new value (or is empty) and the credential shows "set". | spec Goal 5, Contracts PutCredentialRequest; DeskAgentAddressChanged board     |
| BR-15 | validation          | When a member changes the API address and does not supply a new credential, the address is not saved: clicking **Save agent** alone never changes it, and **Test and replace** needs a token; after a reload the old address and old credential are unchanged.                                              | spec Goal 5, Contracts PutAgentRequest (no address field)                      |
| BR-16 | state-transition    | When the address change is saved but writing the new credential then fails, the member sees the new address with the credential shown as "not set" (never the old credential paired with the new address), and a run for this agent does not start until a credential is set.                                  | spec Anti-goals, Design API putCredential order                                |
| BR-17 | side-effect         | When a member saves a new credential or address, the Default model dropdown reloads from the new address and credential without a page reload.                                                                                                                                                              | spec Web Queries (invalidated after a credential or address save)             |
| BR-18 | conditional-display | When a member opens the setup wizard's Agent step, the member sees "API address" ("Optional. Leave empty for Anthropic's default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only.") and a "Default model" dropdown (with "Other model…") instead of the fixed opus/sonnet choice. | spec Web Setup wizard; Setup2 board                                            |
| BR-19 | feedback-state      | When the model list can't be loaded in the wizard's Agent step (no token accepted yet, unreachable, rejected, empty, live lists off), the member sees `opus`, `sonnet`, `haiku`, "Other model…" and a note saying why.                                                                                          | spec Goal 2, Goal 1                                                            |
| BR-20 | validation          | When a credential is already saved and the member changes the API address in the wizard without pasting the token again, the member sees the field error "Paste the token again to change the API address." and cannot continue.                                                                              | spec Web Setup wizard                                                          |
| BR-21 | persistence         | When a member clicks Continue on the Agent step with a token, an API address and a default model, then leaves and resumes the project from the project list, the step shows the saved default model, and the address, and the credential as set.                                                              | spec Web Setup wizard; frontend-design §4.5                                    |
| BR-22 | conditional-display | When a member opens the rule form (Desk → Routing rules, new or edit, or setup step 4), "With agent" lists the project's agents by name only (e.g. "Claude", no "(opus)" suffix).                                                                                                                            | spec Web Rule form; DeskRules, Setup4 boards                                   |
| BR-23 | conditional-display | When a member opens the rule form, a "Model" field shows "Default model" as its first option, then the selected agent's models (live list), then "Other model…"; on step 4 its note reads "Default model is the one picked in step 2."                                                                        | spec Goal 6, Web Rule form; Setup4 board                                       |
| BR-24 | feedback-state      | When the selected agent's model list can't be loaded in the rule form, the member sees `opus`, `sonnet`, `haiku` after "Default model", "Other model…", and a note saying why.                                                                                                                                | spec Goal 2, Web Rule form                                                     |
| BR-25 | persistence         | When a member picks a listed model in the rule form and saves the rule, reopening the rule shows that model selected, also after a reload.                                                                                                                                                                  | spec Goal 6, Contracts RuleDto                                                 |
| BR-26 | persistence         | When a member types a model name under "Other model…" in the rule form and saves the rule, reopening the rule shows "Other model…" with the name exactly as typed (trimmed).                                                                                                                                  | spec Goal 3, Goal 6                                                            |
| BR-27 | persistence         | When a member sets an existing rule's Model back to "Default model" and saves, reopening the rule shows "Default model" (the rule follows the default again).                                                                                                                                                | spec Contracts UpdateRuleRequest (null resets)                                 |
| BR-28 | state-transition    | When a member picks another agent in "With agent", the Model list reloads for that agent and a model already picked or typed stays selected.                                                                                                                                                                | spec Web Rule form                                                             |
| BR-29 | validation          | When a member saves a rule whose typed model is invalid (same cases as BR-7), the member sees the error on the Model field and the rule is not saved.                                                                                                                                                       | spec Web Rule form (`/model` → Model field), Contracts AgentModelId            |
| BR-30 | conditional-display | When a rule names its own model, the rules list row and the rule sentence still read "… run code-build with Claude" with no model shown.                                                                                                                                                                     | spec Web (rule sentence, rows unchanged); DeskRules board                      |
| BR-31 | side-effect         | When a comment triggers a rule that names its own model, the run is started with that model, and Run detail shows that model for the run.                                                                                                                                                                    | spec Goal 7, Routing and intake, API runs                                      |
| BR-32 | side-effect         | When a comment triggers a rule that follows the default model, the run is started with the agent's default model at that moment, and Run detail shows it.                                                                                                                                                    | spec Routing and intake                                                        |
| BR-33 | state-transition    | When a member changes the default model, the next run of a rule that follows the default uses the new model, a rule that names its own model keeps its model, and a run already queued keeps the model it was queued with.                                                                                    | spec Intent (terms), Routing and intake                                        |
| BR-34 | state-transition    | When a paused run is resumed after the default model changed, Run detail and the pod log still show the model the run started with.                                                                                                                                                                          | spec Routing and intake, Worker                                                |
| BR-35 | side-effect         | When a run's pod starts, the run's terminal output begins with one line `agentdesk: agent claude model <model> endpoint <origin>`, where `<origin>` is the API address's origin (scheme and host, no path) or `default` when the agent has no address.                                                       | spec Runner (entrypoint, fake pod)                                             |
| BR-36 | side-effect         | When a paused run is resumed after the agent's API address or credential was changed, the resumed pod starts with the current address (its first terminal line shows the new endpoint) while keeping the run's model.                                                                                         | spec Worker (address and credential read at each pod start)                    |
| BR-37 | calculation         | When a run was queued before this change (no model recorded), Run detail shows the agent's current default model, or "unknown" if the agent has none.                                                                                                                                                        | spec Worker details(), API runs.service                                        |

### Test cases

#### BR-1: Default model dropdown lists the provider's models

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-1.1 | positive | mock | Agent has a saved credential; the model list is mocked as live with ids `model-b`, `model-a`, `model-c` in that order | 1. Open Desk → Agent & settings. 2. Open the "Default model" dropdown. | Options are `model-b`, `model-a`, `model-c` in that order, then "Other model…" as the last option. The note "Loaded from the provider. Rules that don't name a model use this one." is shown. |
| TC-1.2 | negative | mock | Same as TC-1.1 | 1. Open Desk → Agent & settings. 2. Open the "Default model" dropdown. | `opus`, `sonnet` and `haiku` are not options; no fallback note is shown. |

#### BR-2: Model list falls back to the standard names with a reason

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-2.1 | negative | mock | Agent has no credential saved; list mocked as fallback, reason no credential | 1. Open Desk → Agent & settings. 2. Open "Default model". | Options `opus`, `sonnet`, `haiku`, "Other model…" in that order; a short note says why the list is not live (wording: Q1); no error banner or error state. |
| TC-2.2 | negative | mock | Credential saved; list mocked as fallback, reason unreachable | Same as TC-2.1 | Same options; a short note says the provider could not be reached (Q1); no error state. |
| TC-2.3 | negative | mock | Credential saved; list mocked as fallback, reason rejected | Same as TC-2.1 | Same options; a short note says the credential was rejected (Q1); no error state. |
| TC-2.4 | negative | mock | Credential saved; list mocked as fallback, reason empty list | Same as TC-2.1 | Same options; a short note says the provider returned no models (Q1); no error state. |
| TC-2.5 | negative | local | Local stack (live lists off), agent has a credential | 1. Open Desk → Agent & settings. 2. Open "Default model". | Options `opus`, `sonnet`, `haiku`, "Other model…"; a short note says live lists are turned off (Q1); no error state. |

#### BR-3: Fallback note shows only the address host

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-3.1 | positive | mock | Agent address `https://gateway.harbor-labs.com/v1/anthropic`; list mocked as fallback, reason unreachable | 1. Open Desk → Agent & settings. | The note reads "Showing the standard names. The model list at gateway.harbor-labs.com could not be loaded." The note does not contain `/v1/anthropic` or `https://`. |
| TC-3.2 | negative | mock | Same address; credential value `sk-test-secret-123`; list mocked as fallback, reason rejected, with the mocked response carrying provider text "invalid x-api-key sk-test-secret-123" | 1. Open Desk → Agent & settings. 2. Read the whole page text. | Neither `sk-test-secret-123` nor "invalid x-api-key" appears anywhere on the page; the note names only `gateway.harbor-labs.com`. |
| TC-3.3 | negative | mock | Agent has no address (provider default); list mocked as fallback, reason unreachable | 1. Open Desk → Agent & settings. | The note says why without naming any host (exact wording: Q1). |

#### BR-4: "Other model…" shows a text input

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-4.1 | state | mock | Fallback list; saved default model `sonnet` | 1. Open Desk → Agent & settings. 2. Pick "Other model…" in "Default model". | A text input appears with the note "Sent to Claude Code exactly as typed. Rules that don't name a model use this one." |
| TC-4.2 | state | mock | Same; "Other model…" picked and `my-model` typed | 1. Pick `haiku` in "Default model". | The text input and its note are no longer shown; `haiku` is selected. |
| TC-4.3 | negative | mock | Fallback list; saved default model `sonnet` | 1. Open Desk → Agent & settings. | No text input is shown while a listed model is selected. |

#### BR-5: A saved model outside the list shows under "Other model…"

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-5.1 | positive | mock | Live list `claude-opus-x-20260101`, `claude-sonnet-x-20260101`; saved default model `vendor/model-1` | 1. Open Desk → Agent & settings. | "Other model…" is selected and the text input holds `vendor/model-1`. |
| TC-5.2 | positive | mock | Live list with only dated ids (as TC-5.1); saved default model `sonnet` | 1. Open Desk → Agent & settings. | "Other model…" is selected and the text input holds `sonnet`. |
| TC-5.3 | negative | mock | Live list includes `claude-sonnet-x-20260101`; saved default model is that id | 1. Open Desk → Agent & settings. | That option is selected; no text input is shown. |

#### BR-6: Saving a default model keeps it exactly

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-6.1 | positive | local | Local stack; saved default model `sonnet` | 1. Open Desk → Agent & settings. 2. Pick `haiku` in "Default model". 3. Click **Save agent**. 4. Reload the page. | After step 4 "Default model" shows `haiku`. |
| TC-6.2 | positive | local | Same | 1. Pick "Other model…". 2. Type `sonnet[1m]`. 3. Click **Save agent**. 4. Reload. | "Other model…" is selected and the input holds `sonnet[1m]` exactly. |
| TC-6.3 | positive | local | Same | 1. Pick "Other model…". 2. Type `vendor/model`. 3. Click **Save agent**. 4. Reload. | The input holds `vendor/model` exactly. |
| TC-6.4 | boundary | local | Same | 1. Pick "Other model…". 2. Type `  my-model-1  ` (two spaces before and after). 3. Click **Save agent**. 4. Reload. | The input holds `my-model-1` with no surrounding spaces. |

#### BR-7: Invalid default model names are refused

All cases: local stack, saved default model `sonnet`; steps: 1. Open Desk → Agent & settings. 2. Pick "Other model…". 3. Enter the value. 4. Click **Save agent**. 5. Reload. Wording of the field error: Q3.

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-7.1 | negative | local | Value: empty (input cleared) | As above | A field error appears on the Model field; after reload "Default model" still shows `sonnet`. |
| TC-7.2 | boundary | local | Value: 201 characters ("a" × 201) | As above | A field error appears on the Model field; after reload still `sonnet`. |
| TC-7.3 | boundary | local | Value: 200 characters ("a" × 200) | As above | No field error; after reload the input holds the 200-character value. |
| TC-7.4 | boundary | local | Value: `a` (1 character) | As above | No field error; after reload the input holds `a`. |
| TC-7.5 | negative | local | Value: `my model` (space inside) | As above | A field error appears on the Model field; after reload still `sonnet`. |
| TC-7.6 | negative | local | Value: `a` + a tab character + `b`, pasted | As above | A field error appears on the Model field; after reload still `sonnet`. |
| TC-7.7 | negative | local | Value: `-opus` (starts with a hyphen) | As above | A field error appears on the Model field; after reload still `sonnet`. |
| TC-7.8 | negative | local | Value: `.opus` (starts with a dot) | As above | A field error appears on the Model field; after reload still `sonnet`. |
| TC-7.9 | positive | local | Value: `9model` (starts with a digit) | As above | No field error; after reload the input holds `9model`. |

#### BR-8: Save agent does not revert the run limits

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-8.1 | state | local | Two sessions of the same member on Desk → Agent & settings; both loaded with the same run limits and default model `sonnet` | 1. In session B change one run limit to a new value and save it. 2. In session A (not reloaded) pick `haiku` in "Default model". 3. In session A click **Save agent**. 4. Reload session A. | The run limit shows session B's new value; "Default model" shows `haiku`. |

#### BR-9: Picker loading and error states still allow a typed model

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-9.1 | state | mock | The model list request is held open (delayed) | 1. Open Desk → Agent & settings. | While pending, the picker shows its loading state (look and copy: Q2); "Other model…" can be chosen and a name typed into the input. |
| TC-9.2 | negative | mock | The model list request itself fails (HTTP 500) | 1. Open Desk → Agent & settings. 2. Pick "Other model…". 3. Type `my-model`. | The picker shows its error state (look and copy: Q2); "Other model…" is available; the input accepts `my-model`. |

#### BR-10: Dropdown shows each model once, in the provider's order

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-10.1 | positive | mock | Live list mocked with ids `m-5`, `m-1`, `m-4`, `m-2`, `m-3` (not alphabetical) | 1. Open Desk → Agent & settings. 2. Open "Default model". | Options are `m-5`, `m-1`, `m-4`, `m-2`, `m-3` in that order, each once, then "Other model…". |
| TC-10.2 | boundary | mock | Live list mocked with 500 distinct ids `m-1` … `m-500` in order | 1. Open Desk → Agent & settings. 2. Open "Default model". | All 500 ids are options once each in order, then "Other model…". |

#### BR-11: Empty API address means the provider default

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-11.1 | positive | local | Local stack; agent has no credential and no address | 1. Open Desk → Agent & settings. 2. Leave "API address" empty. 3. Paste a token and click **Test and replace**. 4. Reload. | "API address" is empty and shows "Optional. Leave empty for Anthropic's default."; the credential shows "set". |

#### BR-12: API address validation

All cases: local stack, agent saved with no address; steps: 1. Open Desk → Agent & settings. 2. Type the address in "API address". 3. Paste a token. 4. Click **Test and replace**. 5. Reload. Wording and place of the address error: Q3; whether the token test runs against the address: Q4.

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-12.1 | negative | local | Address `http://gateway.harbor-labs.com` | As above | A field error is shown; after reload "API address" is empty. |
| TC-12.2 | negative | local | Address `https://user:pass@gateway.harbor-labs.com` | As above | A field error is shown; nothing saved (address empty after reload). |
| TC-12.3 | negative | local | Address `https://gateway.harbor-labs.com/v1?key=1` (query) | As above | A field error is shown; nothing saved. |
| TC-12.4 | negative | local | Address `https://gateway.harbor-labs.com/v1#top` (fragment) | As above | A field error is shown; nothing saved. |
| TC-12.5 | boundary | local | Address `https://gateway.harbor-labs.com/` + "a" × 2017 (2049 characters in total) | As above | A field error is shown; nothing saved. |
| TC-12.6 | boundary | local | Address of exactly 2048 characters: `https://gateway.harbor-labs.com/` + "a" × 2016 | As above | No field error; after reload "API address" holds the 2048-character value. |
| TC-12.7 | negative | local | Addresses tried one at a time: `https://localhost`, `https://app.localhost` | As above, once per address | A field error is shown each time; nothing saved. |
| TC-12.8 | negative | local | Addresses tried one at a time: `https://10.0.0.1`, `https://172.16.0.1`, `https://192.168.1.1`, `https://127.0.0.1`, `https://169.254.169.254`, `https://100.64.0.1`, `https://0.0.0.0` | As above, once per address | A field error is shown each time; nothing saved. |
| TC-12.9 | positive | local | Address `https://gateway.harbor-labs.com` | As above | No field error; after reload "API address" holds `https://gateway.harbor-labs.com` and the credential shows "set". |

#### BR-13: Editing the address switches the credential to its replacing state

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-13.1 | state | mock | Agent has a saved credential and no address | 1. Open Desk → Agent & settings. 2. Type `https://gateway.harbor-labs.com` in "API address". | The credential section shows "Replaced when you save", "Credential needed again" and "The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one." The address note reads "Changed from Anthropic's default. It is saved together with the new credential below." |
| TC-13.2 | negative | mock | Same | 1. Open Desk → Agent & settings. | None of the replacing-state texts of TC-13.1 are shown; the credential shows its normal "set" state. |
| TC-13.3 | state | mock | Agent has a saved address `https://gateway.harbor-labs.com` and a credential | 1. Open Desk → Agent & settings. 2. Clear "API address". | The credential section shows its replacing state ("Credential needed again"); the address note wording for this change is not given by a source (Q6). |

#### BR-14: Address and credential are saved together

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-14.1 | positive | local | Agent has a credential and no address | 1. Open Desk → Agent & settings. 2. Type `https://gateway.harbor-labs.com` in "API address". 3. Paste a new token. 4. Click **Test and replace**. 5. Reload. | "API address" shows `https://gateway.harbor-labs.com`; the credential shows "set". |
| TC-14.2 | positive | local | Agent saved with address `https://gateway.harbor-labs.com` and a credential | 1. Change "API address" to `https://gw2.harbor-labs.com`. 2. Paste a new token. 3. Click **Test and replace**. 4. Reload. | "API address" shows `https://gw2.harbor-labs.com`; the credential shows "set". |
| TC-14.3 | positive | local | Same as TC-14.2 | 1. Clear "API address". 2. Paste a new token. 3. Click **Test and replace**. 4. Reload. | "API address" is empty with "Optional. Leave empty for Anthropic's default."; the credential shows "set". |

#### BR-15: No address change without a new credential

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-15.1 | negative | local | Agent saved with address `https://gateway.harbor-labs.com` and a credential | 1. Open Desk → Agent & settings. 2. Change "API address" to `https://gw2.harbor-labs.com`. 3. Click **Save agent** without a token. 4. Reload. | After reload "API address" is `https://gateway.harbor-labs.com` and the credential still shows "set". |
| TC-15.2 | negative | local | Same | 1. Change "API address" to `https://gw2.harbor-labs.com`. 2. Leave the token empty. 3. Try **Test and replace**. 4. Reload. | The replacement does not go through (message or disabled control: Q4); after reload the old address and the credential "set" are unchanged. |

#### BR-16: A failed credential write leaves the new address with no credential

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-16.1 | state | local | Agent saved with address `https://gateway.harbor-labs.com` and a credential; the test environment makes writing the new credential fail | 1. Change "API address" to `https://gw2.harbor-labs.com`. 2. Paste a token. 3. Click **Test and replace**. 4. Reload. | After reload "API address" shows `https://gw2.harbor-labs.com` and the credential shows "not set". |
| TC-16.2 | negative | local | State of TC-16.1 reached; a rule routes comments to this agent | 1. Add a comment on a ticket that triggers the rule. 2. Open the Run list. | No run for this agent starts; it is not shown as running (how a refusal is shown: not stated by a source). |
| TC-16.3 | positive | local | State of TC-16.1 reached; the failure injection removed | 1. Paste a token in the credential section. 2. Click **Test and replace**. 3. Add a comment that triggers the rule. | The credential shows "set" and the run starts. |

#### BR-17: Saving a credential or address reloads the model list

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-17.1 | state | mock | Agent has no credential; the list is mocked as fallback before the save and as live (`model-x`, `model-y`) after it | 1. Open Desk → Agent & settings. 2. Paste a token. 3. Click **Test and replace**. 4. Open "Default model" without reloading. | Options are `model-x`, `model-y`, then "Other model…"; the fallback note is gone. |
| TC-17.2 | state | mock | Agent has a credential and a live list `model-a`; after an address change the mocked list for the new address is `model-g1`, `model-g2` | 1. Change "API address" to `https://gateway.harbor-labs.com`. 2. Paste a token. 3. Click **Test and replace**. 4. Open "Default model" without reloading. | Options are `model-g1`, `model-g2`, then "Other model…"; `model-a` is not offered. |

#### BR-18: Wizard Agent step has an API address and a model dropdown

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-18.1 | positive | mock | A new project in the setup wizard, live list mocked (`model-a`, `model-b`) | 1. Open the wizard and go to the Agent step. | "API address" is shown with "Optional. Leave empty for Anthropic's default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only." "Default model" is a dropdown listing `model-a`, `model-b`, "Other model…". |
| TC-18.2 | negative | mock | Same | 1. Go to the Agent step. 2. Open "Default model". | The fixed two-choice `opus` / `sonnet` list is not shown; "Other model…" is last. |

#### BR-19: Wizard model list fallback

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-19.1 | negative | mock | New project; no token accepted yet; list mocked as fallback, no credential | 1. Go to the Agent step. 2. Open "Default model". | `opus`, `sonnet`, `haiku`, "Other model…" with a note saying why (Q1). |
| TC-19.2 | negative | mock | List mocked as fallback, reason unreachable | Same | Same options; note says the provider could not be reached (Q1). |
| TC-19.3 | negative | mock | List mocked as fallback, reason rejected | Same | Same options; note says the credential was rejected (Q1). |
| TC-19.4 | negative | mock | List mocked as fallback, reason empty | Same | Same options; note says the list was empty (Q1). |
| TC-19.5 | negative | local | Local stack, live lists off, new project | Same | Same options; note says live lists are turned off (Q1). |

#### BR-20: Wizard: changing the address needs the token again

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-20.1 | negative | mock | Project resumed on the Agent step; credential already saved; saved address empty | 1. Type `https://gateway.harbor-labs.com` in "API address". 2. Leave the token empty. 3. Press **Continue**. | The field error "Paste the token again to change the API address." is shown; the wizard stays on the Agent step. |
| TC-20.2 | positive | mock | Same | 1. Type `https://gateway.harbor-labs.com`. 2. Paste a token. 3. Press **Continue**. | No such error; the wizard moves to the next step. |
| TC-20.3 | negative | mock | Same | 1. Leave "API address" unchanged and the token empty. 2. Press **Continue**. | No such error; the wizard moves to the next step. |

#### BR-21: Agent step choices survive leaving and resuming

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-21.1 | positive | local | New project at the Agent step | 1. Paste a token. 2. Type `https://gateway.harbor-labs.com` in "API address". 3. Pick `haiku` in "Default model". 4. Press **Continue**. 5. Go to the project list. 6. Resume the project. 7. Go to the Agent step. | "Default model" shows `haiku`; "API address" shows `https://gateway.harbor-labs.com`; the credential shows as set. |
| TC-21.2 | positive | local | Same | As TC-21.1 but pick "Other model…" and type `vendor/model` in step 3 | "Other model…" is selected with `vendor/model`; address and credential as in TC-21.1. |

#### BR-22: "With agent" lists agents by name only

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-22.1 | positive | mock | Project agent "Claude" with default model `opus` | 1. Open Desk → Routing rules. 2. Open the new rule form. 3. Open "With agent". | The option reads "Claude" with no "(opus)" or other model suffix. |
| TC-22.2 | positive | mock | Same; an existing rule | 1. Open Desk → Routing rules. 2. Edit the rule. 3. Read "With agent". | It reads "Claude" with no suffix. |
| TC-22.3 | positive | mock | Same; setup wizard | 1. Go to step 4 of the wizard. 2. Open "With agent". | It reads "Claude" with no suffix. |

#### BR-23: Rule form Model field

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-23.1 | positive | mock | Agent "Claude" with live list `model-a`, `model-b` | 1. Open Desk → Routing rules. 2. Open the new rule form. 3. Open "Model". | Options in order: "Default model", `model-a`, `model-b`, "Other model…". |
| TC-23.2 | positive | mock | Same; setup wizard | 1. Go to step 4. 2. Read the "Model" field note. | The note reads "Default model is the one picked in step 2." |

#### BR-24: Rule form model list fallback

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-24.1 | negative | mock | List for the agent mocked as fallback, reason unreachable | 1. Open the new rule form on Desk → Routing rules. 2. Open "Model". | Options in order: "Default model", `opus`, `sonnet`, `haiku`, "Other model…"; a note says why (Q1). |
| TC-24.2 | negative | mock | Fallback, reason no credential | Same | Same options and a note (Q1). |
| TC-24.3 | negative | mock | Fallback, reason rejected | Same | Same options and a note (Q1). |
| TC-24.4 | negative | mock | Fallback, reason empty | Same | Same options and a note (Q1). |
| TC-24.5 | negative | local | Local stack, live lists off | Same | Same options; the note says live lists are turned off (Q1). |

#### BR-25: A listed rule model is saved

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-25.1 | positive | local | Local stack, project with an agent | 1. Open the new rule form on Desk → Routing rules. 2. Fill the rule's other fields. 3. Pick `haiku` in "Model". 4. Save the rule. 5. Reopen the rule. 6. Reload and reopen it again. | "Model" shows `haiku` after step 5 and after step 6. |
| TC-25.2 | positive | local | An existing rule following the default model | 1. Edit the rule. 2. Pick `opus` in "Model". 3. Save. 4. Reload and reopen the rule. | "Model" shows `opus`. |

#### BR-26: A typed rule model is saved exactly

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-26.1 | positive | local | Local stack, project with an agent | 1. Open the new rule form. 2. Fill the other fields. 3. Pick "Other model…" in "Model". 4. Type `  vendor/model[1m]  `. 5. Save the rule. 6. Reopen the rule. 7. Reload and reopen. | "Model" shows "Other model…" with `vendor/model[1m]` (no surrounding spaces) after steps 6 and 7. |

#### BR-27: Resetting a rule's model to the default

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-27.1 | positive | local | A rule naming model `haiku` | 1. Edit the rule. 2. Pick "Default model" in "Model". 3. Save. 4. Reopen the rule. 5. Reload and reopen. | "Model" shows "Default model" after steps 4 and 5. |

#### BR-28: Changing the agent in the rule form

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-28.1 | state | mock | Project with agents "Claude" (list `model-a`, `model-b`) and a second agent "Other" (list `model-x`, `model-y`) | 1. Open the new rule form. 2. Pick "Other" in "With agent". 3. Open "Model". | Options are "Default model", `model-x`, `model-y`, "Other model…". |
| TC-28.2 | state | mock | Same; "Claude" selected and "Other model…" with `vendor/model` typed | 1. Pick "Other" in "With agent". | The Model field still shows "Other model…" with `vendor/model`. |
| TC-28.3 | state | mock | Same; "Claude" selected and `model-a` picked | 1. Pick "Other" in "With agent". | The picked model value `model-a` is kept (shown as selected, or under "Other model…" with `model-a` when the new list lacks it). |

#### BR-29: Invalid rule model is refused

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-29.1 | negative | local | Local stack; no rule "R1" yet | 1. Open the new rule form; name or fill the rule as "R1". 2. Pick "Other model…" and type `my model` (space inside). 3. Save. 4. Open the rules list. | An error appears on the Model field (wording: Q3); no "R1" row exists in the rules list. |
| TC-29.2 | negative | local | An existing rule naming `haiku` | 1. Edit the rule. 2. Pick "Other model…" and type `bad model`. 3. Save. 4. Reload and reopen the rule. | An error appears on the Model field; the rule still shows `haiku`. |
| TC-29.3 | negative | mock | Rule form open | 1. Pick "Other model…" and type 201 characters ("a" × 201). 2. Save. | An error appears on the Model field. |
| TC-29.4 | negative | mock | Rule form open | 1. Pick "Other model…" and type `-opus`. 2. Save. | An error appears on the Model field. |
| TC-29.5 | negative | mock | Rule form open | 1. Pick "Other model…" and leave the input empty. 2. Save. | An error appears on the Model field. |
| TC-29.6 | boundary | local | Local stack | 1. Pick "Other model…" and type 200 characters ("a" × 200). 2. Save. 3. Reopen the rule. | No error; the rule is saved and shows the 200-character value under "Other model…". |

#### BR-30: Rule sentence and rows do not show the model

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-30.1 | positive | mock | A rule that runs `code-build` with agent "Claude" and names model `haiku` | 1. Open Desk → Routing rules. | The rule's row reads "… run code-build with Claude" with no model text (`haiku` appears nowhere in the row). |
| TC-30.2 | positive | mock | Same | 1. Open the rule form for that rule. | The rule sentence reads "… run code-build with Claude" with no model shown. |
| TC-30.3 | negative | mock | A rule that follows the default model | 1. Open Desk → Routing rules. | The row reads "… run code-build with Claude", identical in form to TC-30.1. |

#### BR-31: A rule's own model is used for the run

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-31.1 | positive | local | Rule names model `haiku`; agent default model `sonnet` | 1. Add a comment on a ticket that triggers the rule. 2. Open the new run's Run detail. | Run detail shows model `haiku`. |
| TC-31.2 | positive | local | Rule names model `sonnet[1m]` | Same | Run detail shows `sonnet[1m]` exactly. |

#### BR-32: A default-following rule uses the default at that moment

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-32.1 | positive | local | Rule follows the default; agent default model `opus` | 1. Add a comment that triggers the rule. 2. Open Run detail. | Run detail shows `opus`. |
| TC-32.2 | positive | local | Same; agent default model typed `vendor/model-1` | Same | Run detail shows `vendor/model-1`. |

#### BR-33: Changing the default model

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-33.1 | state | local | Rule A follows the default; rule B names `haiku`; default `sonnet`; a run from rule A already exists | 1. Open Desk → Agent & settings. 2. Pick `opus` in "Default model" and click **Save agent**. 3. Trigger rule A with a comment. 4. Trigger rule B with a comment. 5. Open the Run detail of each new run. | Rule A's new run shows `opus`; rule B's new run shows `haiku`. |
| TC-33.2 | state | local | Same as TC-33.1 | After step 2 of TC-33.1, open the Run detail of the run that existed before. | It still shows `sonnet`. |

#### BR-34: A resumed run keeps its model

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-34.1 | state | local | A run started under default `sonnet` and now paused (how a run pauses and the resume control's label: Q7) | 1. Change the default model to `opus` on Desk → Agent & settings. 2. Resume the run. 3. Open Run detail and the run's terminal. | Run detail shows `sonnet`; the terminal's line for the resumed pod reads `agentdesk: agent claude model sonnet endpoint …`. |

#### BR-35: First terminal line names agent, model and endpoint

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-35.1 | positive | local | Agent default `haiku`, address `https://gateway.harbor-labs.com/v1/anthropic`, rule follows the default | 1. Trigger the rule with a comment. 2. Open the run's terminal. | The first line is `agentdesk: agent claude model haiku endpoint https://gateway.harbor-labs.com` (origin only, no `/v1/anthropic`). |
| TC-35.2 | positive | local | Agent default `sonnet`, no address | Same | The first line is `agentdesk: agent claude model sonnet endpoint default`. |
| TC-35.3 | positive | local | Rule names model `vendor/model-1`; agent has no address | Same | The first line is `agentdesk: agent claude model vendor/model-1 endpoint default`. |

#### BR-36: Resume uses the current address

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-36.1 | state | local | Run started with no address (first line `... endpoint default`) and now paused (Q7) | 1. On Desk → Agent & settings set "API address" to `https://gateway.harbor-labs.com`, paste a token, click **Test and replace**. 2. Resume the run. 3. Open its terminal. | The resumed pod's first line is `agentdesk: agent claude model <run's model> endpoint https://gateway.harbor-labs.com`; Run detail still shows the run's original model. |
| TC-36.2 | state | local | Run started under address `https://gateway.harbor-labs.com`, paused (Q7) | 1. Clear "API address", paste a token, click **Test and replace**. 2. Resume the run. 3. Open its terminal. | The resumed pod's first line ends `endpoint default`; the model is the run's original one. |

#### BR-37: Runs queued before this change

| Case | Type | Env | Given | Steps | Expected |
| ---- | ---- | --- | ----- | ----- | -------- |
| TC-37.1 | positive | local | A seeded run with no model recorded; agent default `sonnet` | 1. Open that run's Run detail. | It shows `sonnet`. |
| TC-37.2 | state | local | Same; then the default is changed to `opus` | 1. Change the default to `opus` and save. 2. Open the seeded run's Run detail. | It shows `opus` (the current default). |
| TC-37.3 | boundary | local | A seeded run with no model recorded; the agent has no default model | 1. Open Run detail. | It shows "unknown". |

### Open questions

- Q1 (BR-2, BR-3, BR-19, BR-24; TC-2.1 to TC-2.5, TC-3.3, TC-19.1 to TC-19.5, TC-24.1 to TC-24.5): The boards give wording only for the "could not be loaded" note with a custom address. Until answered, the cases assert the fallback options and that a short note explaining the reason is shown, with no error state; only TC-3.1 asserts exact text.
- Q2 (BR-9, TC-9.1, TC-9.2): The picker's loading and error states have no stated look or copy. Until answered, the cases assert that "Other model…" stays usable and a name can be typed.
- Q3 (BR-7, BR-12, BR-29): The field-error wording for an invalid model and for an invalid address, and where the address error appears on Desk → Agent, are not stated. Until answered, the cases assert an error on the Model field (model) or a field error (address), and that nothing is saved.
- Q4 (BR-12, BR-13, BR-14, BR-15; TC-12.x, TC-15.2): What Cancel in the replace dialog does to an edited address, whether the "Test and replace" test call uses the new address, and whether a failed test keeps it. Until answered, cases assert only the saved result after reload and that a token is required.
- Q5 (BR-18, BR-21, BR-32): Which model is preselected in the wizard's Agent step for a new project. Until answered, every wizard case picks its model explicitly.
- Q6 (BR-13, TC-13.3): The address note wording when the address changes from a non-default address or is cleared (the board gives it only for a change from Anthropic's default). Until answered, TC-13.3 asserts the replacing-state credential texts only.
- Q7 (BR-34, BR-36): How a run becomes paused in the local stack and the label of the control that resumes it are not stated in the sources read. Until answered, the cases describe them by purpose.
