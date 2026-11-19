<!-- dev-plan: kind=plan id=agent-model-routing rev=1 hash=072695aed337 spec=docs/superpowers/specs/2026-11-19-agent-model-routing-design.md spec-hash=cd2506f36e26 -->
# Agent models, custom API address and per-rule model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent gets a live model list with built-in fallback and typed names, an optional public `https` API address that only changes together with a new credential, and a routing rule names its own model; every run starts with exactly its agent, model and address.

**Architecture:** Contracts and one migration land first, with every consumer kept compiling. A Claude agent adapter in `packages/core` (behind `agentAdapterFor(kind)`) owns built-in names, credential env names, launch env and the live list, which is fetched through an SSRF-guarded undici transport. The API reads the credential only to list models, the intake freezes the model on the run, the worker builds the Job env from the adapter, and the runner passes `--model`. The web gets a shared `ModelPicker` built from `ds` primitives, wired into Desk → Agent, the rule form and the setup wizard.

**Tech Stack:** TypeScript (strict), Zod 4, Drizzle + Postgres 18, NestJS/Fastify, Temporal worker, undici (`Agent`, `MockAgent`), bash runner, React 19 + TanStack Query/Form/Router, MSW, Storybook, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-agent-model-routing-design.md` (rev 2). Read it with this plan; its "E2E requirements" section holds the BR/TC tables the e2e tasks cite.

## Global Constraints

- AGENTS.md rules 1–11 apply to every task: contracts first; layering `apps → core → db → contracts`, `web → contracts` only; provider-agnostic names; `withOrg` on every query; secrets by name only; untrusted text never interpolated into shell, k8s specs or SQL; authz on every endpoint; never edit an applied migration; a bug fix starts with a failing test; no network in tests; design tokens, stories and loading/empty/error states; strict TS with Zod at boundaries.
- No new dependency. `undici` (already in `packages/core`), Zod, existing `ds` primitives and the existing Claude Code CLI cover everything.
- Built-in Claude names are exactly `opus`, `sonnet`, `haiku`, in that order.
- `AgentModelId`: trimmed, 1–200 characters, `^[A-Za-z0-9][A-Za-z0-9._:/@\[\]+-]*$`.
- `AgentBaseUrl`: absolute `https:` URL, at most 2048 characters, no username/password, query or fragment; hostnames `localhost` and `*.localhost` rejected; IP-literal hosts in blocked ranges rejected.
- Blocked ranges (contract check and connect-time check): `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.168.0.0/16`, `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`.
- Live list: `GET <base>/v1/models?limit=1000`, `<base>` = address or `https://api.anthropic.com`, appended to the address's path; header `anthropic-version: 2023-06-01`; `api_key` in `x-api-key`; `oauth_token` as `Authorization: Bearer` plus `anthropic-beta: oauth-2025-04-20`; follow `has_more`/`last_id` for at most 5 pages; no redirects; 5 s total timeout; 1 MB body cap.
- Errors and logs never carry the upstream body, the credential or request headers; logs name the error class and the address's host only.
- Runner launch line, exact shape: `agentdesk: agent <kind> model <model> endpoint <origin|default>`.
- `AGENT_MODELS_SOURCE: 'live' | 'builtin'`, default `live`; `.env.example` (the local stack and local e2e env) sets `builtin`.
- UI copy comes from the approved boards in `design/prototype/project/` (`DeskAgent`, `DeskAgentCustomModel`, `DeskAgentAddressChanged`, `Setup2`, `Setup4`, `DeskRules`, `DeskRulesPrompt`, `DeskRulesPromptNew`, `DeskRulesPromptError`). Copy lines quoted in this plan are taken from those boards or the spec's BR table; copy marked `Agent call:` is new.
- **Prototype gate and Storybook first:** no task that changes `apps/web/src/{ds,components,screens}` or a web route starts before the human has approved the boards in writing. Screen and component tasks (Tasks 9–12) add the stories before the wiring tasks (Tasks 13–15) start; the dependencies below enforce that order.
- Sensitive paths (migration, run Job/runner, agent credential handling, auth on the new route): every task touching them carries the `review:sensitive` label.
- Before every commit: `devbox run fix` until it prints `fix: clean.`; Conventional Commits with the package as scope; PRs around 800 lines or fewer.

## Review Focus

1. **An address with a path and a trailing slash** (`https://gw.example.com/anthropic/`): a person expects the list at `/anthropic/v1/models`, never `//v1/models` or the path dropped. Test in Task 3.
2. **A saved default model missing from the live list** (`sonnet` while the provider lists only dated ids): a person expects "Other model…" selected with `sonnet` in the input, and Save agent without touching it keeps `sonnet`. Tests in Task 9 and Task 13.
3. **Disguised private addresses** (`https://2130706433`, `https://0x7f.0.0.1`, `https://[::ffff:127.0.0.1]`, `https://[::1]`): a person expects each refused like `https://127.0.0.1`. Tests in Task 1 (contract) and Task 2 (transport).
4. **Editing only a rule's model**: a person expects the PATCH to carry only `model` (no other field reverted), and choosing "Default model" to send `model: null`. Test in Task 14.
5. **Typing the API address back to the saved value**: a person expects the credential section to leave its replacing state, and Test and replace to send no `baseUrl`. Test in Task 11.

## Needs approval

None.

## Agent calls made while planning

- Agent call: `isBlockedIp` and the range lists live in `packages/contracts` (`src/net.ts`), pure TS, because the contract (used by the browser) and the core transport must share one list and contracts cannot import core.
- Agent call: an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) is judged by its IPv4 part, because otherwise `::ffff:127.0.0.1` would pass.
- Agent call: field-error wording (spec Q3): model "Use 1 to 200 letters, digits or . _ : / @ [ ] + -, starting with a letter or digit."; address "Use a public https address with no username, password, query or fragment, up to 2048 characters.", because the spec leaves it open and one message per field keeps the contract simple.
- Agent call: an `AgentModelsError` of kind `invalid` (unparsable body, 404 or another non-2xx other than 401/403) maps to reason `unreachable`, because `AgentModelsDto.reason` has no `invalid` value and the note then says the list could not be loaded.
- Agent call: live ids that fail `AgentModelId` are dropped from the list, because a picked id must be saveable.
- Agent call: the `models` route uses `assertProjectVisible` (org membership), because it is a read and the credential never leaves the server.
- Agent call: with `AGENT_MODELS_SOURCE=builtin` the reason is `disabled` even when no credential is saved, because TC-19.5 expects the "turned off" note on a new project.
- Agent call: a secret-store read failure in the `models` route is a generic 500 ("credential store unavailable"), because it is an internal failure, not an upstream one.
- Agent call: fallback notes for reasons the boards do not word (spec Q1): `no_credential` "Showing the standard names. Save a credential to load the provider's list."; `unreachable` without an address "Showing the standard names. The model list could not be loaded."; `rejected` "Showing the standard names. The provider did not accept the saved credential."; `empty` "Showing the standard names. The provider returned no models."; `disabled` "Showing the standard names. Live model lists are turned off on this server.". The board wording is kept for `unreachable` with an address.
- Agent call: picker options show the model id (with the provider's label as a tooltip), because the approved boards show ids and the stored value is always the id (spec "Left to the builder").
- Agent call: picker loading and error copy (spec Q2): "Loading models…" and "The model list could not be loaded. You can still type a model name.", both with "Other model…" usable, because BR-9 needs typing to stay possible.
- Agent call: address note after a change from a custom address or a clear (spec Q6): "Changed from <saved address>. It is saved together with the new credential below.", following the board's sentence.
- Agent call: "set" and "not set" in the e2e cases mean the credential's "Set … by …" line is shown or absent; no new copy.
- Agent call: "With agent" stays locked to the project's one agent (the boards show it disabled with "One agent per project in the PoC."), because no route lists a project's agents; the Model list is keyed by agent id and the model is a separate field, so a second agent needs no rework.
- Agent call: the runner prints `model default` when `AGENT_MODEL` is empty (a run queued before this change whose agent is gone), so the launch line keeps its shape.
- Agent call: the runner's per-agent `commands.sh` names the env holding the endpoint (`AGENT_ENDPOINT_URL="${ANTHROPIC_BASE_URL:-}"`), so `entrypoint.sh` stays agent-agnostic.
- Agent call: the setup follow-up rule (`/code-review`) is created with `model: null` (follows the default), because step 4 shows a Model field for the first rule only.
- Agent call: mock e2e pick a model-list scenario per agent through the session-storage key `agentdesk.mock.agentModels`, read by the mock worker at start, like the existing `agentdesk.mock.auth` key, because MSW answers inside the service worker where Playwright routing cannot reach.
- Agent call: local e2e helpers move out of `e2e/local/run.spec.ts` into `e2e/local/helpers.ts` in Task 8, so the three local e2e tasks can run in parallel.
- Agent call: TC-16.1 injects the failed credential write by replacing the agent's secret file under `<FAKE_STATE_DIR>/secrets/` with a non-empty directory of the same name, because the spec adds no failure hook and this needs no product change; the API then fails after step 1 of the address change, which is what BR-16 observes.
- Agent call: TC-34 and TC-36 pause a run with a `--fake-fail` comment (agent crash → paused → Resume), as `e2e/local/run.spec.ts` already does (spec Q7).
- Agent call: TC-37 makes a "queued before this change" run by clearing `runs.model` (and `runs.agent_id` for TC-37.3) through the stack's psql (`docker-compose exec -T postgres psql -U postgres -d agentdesk`, as `devbox run db-psql` does), with the run id checked as a UUID and passed on stdin, because no API can create a run without a model.

---

<!-- dev-plan:graph:begin -->
## Task graph

Generated by `dev-plan.mjs graph --write` from each task's **Depends on:** line. Do not edit it by hand.
Tasks in the same wave touch no common file and can be built in parallel; a task starts when everything it depends on is merged.

| Wave | Task | Depends on |
| ---- | ---- | ---------- |
| 1 | Task 1: Contracts, migration and every consumer compiling | none |
| 2 | Task 2: Guarded HTTP transport, ADR and security docs | Task 1 |
| 2 | Task 4: Rule model through the API and intake | Task 1 |
| 2 | Task 8: Web model-list data layer and shared e2e helpers | Task 1 |
| 2 | Task 9: ModelPicker component | Task 1 |
| 3 | Task 3: Claude agent adapter | Task 1, Task 2 |
| 3 | Task 5: Runner passes --model and prints the launch line | Task 2 |
| 3 | Task 10: Rule form Model field on the desk and setup step 4 screens | Task 9 |
| 4 | Task 6: Worker launches with the adapter env | Task 1, Task 3 |
| 4 | Task 7: API agent address, credential order and model list route | Task 1, Task 3 |
| 4 | Task 11: Desk → Agent screen | Task 9, Task 10 |
| 4 | Task 12: Setup Agent step screen | Task 9, Task 10 |
| 4 | Task 14: Desk → Routing rules wiring | Task 8, Task 9, Task 10 |
| 5 | Task 13: Desk → Agent wiring | Task 8, Task 9, Task 11 |
| 5 | Task 15: Setup wizard wiring (Agent step and step 4) | Task 8, Task 9, Task 10, Task 12 |
| 6 | Task 16: E2E mock — Desk → Agent | Task 8, Task 13 |
| 6 | Task 17: E2E mock — rule form and setup wizard | Task 8, Task 14, Task 15 |
| 6 | Task 18: E2E local — Desk → Agent | Task 7, Task 8, Task 13 |
| 6 | Task 19: E2E local — rules and setup wizard | Task 4, Task 7, Task 8, Task 14, Task 15 |
| 6 | Task 20: E2E local — runs start with the configured model and address | Task 4, Task 6, Task 7, Task 8, Task 13 |

```mermaid
graph LR
  T1["1: Contracts, migration and every consumer compiling"]
  T2["2: Guarded HTTP transport, ADR and security docs"]
  T3["3: Claude agent adapter"]
  T4["4: Rule model through the API and intake"]
  T5["5: Runner passes --model and prints the launch line"]
  T6["6: Worker launches with the adapter env"]
  T7["7: API agent address, credential order and model list route"]
  T8["8: Web model-list data layer and shared e2e helpers"]
  T9["9: ModelPicker component"]
  T10["10: Rule form Model field on the desk and setup step 4 screens"]
  T11["11: Desk → Agent screen"]
  T12["12: Setup Agent step screen"]
  T13["13: Desk → Agent wiring"]
  T14["14: Desk → Routing rules wiring"]
  T15["15: Setup wizard wiring (Agent step and step 4)"]
  T16["16: E2E mock — Desk → Agent"]
  T17["17: E2E mock — rule form and setup wizard"]
  T18["18: E2E local — Desk → Agent"]
  T19["19: E2E local — rules and setup wizard"]
  T20["20: E2E local — runs start with the configured model and address"]
  T1 --> T2
  T1 --> T3
  T2 --> T3
  T1 --> T4
  T2 --> T5
  T1 --> T6
  T3 --> T6
  T1 --> T7
  T3 --> T7
  T1 --> T8
  T1 --> T9
  T9 --> T10
  T9 --> T11
  T10 --> T11
  T9 --> T12
  T10 --> T12
  T8 --> T13
  T9 --> T13
  T11 --> T13
  T8 --> T14
  T9 --> T14
  T10 --> T14
  T8 --> T15
  T9 --> T15
  T10 --> T15
  T12 --> T15
  T8 --> T16
  T13 --> T16
  T8 --> T17
  T14 --> T17
  T15 --> T17
  T7 --> T18
  T8 --> T18
  T13 --> T18
  T4 --> T19
  T7 --> T19
  T8 --> T19
  T14 --> T19
  T15 --> T19
  T4 --> T20
  T6 --> T20
  T7 --> T20
  T8 --> T20
  T13 --> T20
```
<!-- dev-plan:graph:end -->

### Task 1: Contracts, migration and every consumer compiling

**Depends on:** none

**Files:**

- Create: `packages/contracts/src/net.ts`
- Create: `packages/contracts/src/net.test.ts`
- Modify: `packages/contracts/src/enums.ts`
- Modify: `packages/contracts/src/schemas/agents.ts`
- Modify: `packages/contracts/src/schemas/agents.test.ts`
- Modify: `packages/contracts/src/schemas/rules.ts`
- Modify: `packages/contracts/src/schemas/rules.test.ts`
- Modify: `packages/contracts/src/routes.ts`
- Modify: `packages/contracts/src/routes.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/db/src/schema/app.ts`
- Create: `packages/db/migrations/0017_agent_model_routing.sql` (generated name may differ; keep `0017_`)
- Create: `packages/db/migrations/meta/0017_snapshot.json` (generated)
- Modify: `packages/db/migrations/meta/_journal.json` (generated)
- Modify: `packages/db/test/migrate.int.test.ts`
- Modify: `apps/api/src/agents/agents.service.ts`
- Modify: `apps/api/src/rules/rules.service.ts`
- Modify: `apps/api/test/agents.int.test.ts`
- Modify: `apps/api/test/rules.int.test.ts`
- Create: `apps/web/src/mocks/dto/agentModels.ts`
- Modify: `apps/web/src/mocks/dto/agents.ts`
- Modify: `apps/web/src/mocks/dto/rules.ts`
- Modify: `apps/web/src/mocks/msw/handlers.ts`
- Modify: `apps/web/src/mocks/msw/contract.test.ts`
- Modify: `apps/web/src/features/desk/rules.form.ts`
- Modify: `apps/web/src/features/desk/map.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces (all exported from `@agentdesk/contracts`):

```ts
// enums.ts
export const AgentKind = z.enum(['claude']);
export type AgentKind = z.infer<typeof AgentKind>;

// net.ts
export const BLOCKED_IPV4_CIDRS: readonly string[]; // the seven IPv4 ranges in Global Constraints
export const BLOCKED_IPV6_CIDRS: readonly string[]; // '::/128', '::1/128', 'fc00::/7', 'fe80::/10'
/** True for an IPv4 dotted quad or IPv6 address (no brackets) in a blocked range; IPv4-mapped IPv6 is judged by its IPv4 part; a non-IP string is false. */
export function isBlockedIp(address: string): boolean;

// schemas/agents.ts
export const AGENT_MODEL_ID_MAX = 200;
export const AgentModelId: z.ZodType<string>;      // trim → 1..200 → pattern; one message (Agent call above)
export const AGENT_BASE_URL_MAX = 2048;
export const AgentBaseUrl: z.ZodType<string>;      // trim → max 2048 → refine(isAllowedAgentBaseUrl); one message
export function isAllowedAgentBaseUrl(raw: string): boolean;
export const AgentModelOption = z.object({ id: z.string(), label: z.string() });
export type AgentModelOption = z.infer<typeof AgentModelOption>;
export const AgentModelsReason = z.enum(['no_credential', 'unreachable', 'rejected', 'empty', 'disabled']);
export type AgentModelsReason = z.infer<typeof AgentModelsReason>;
export const AgentModelsDto = z.object({
  source: z.enum(['live', 'builtin']),
  reason: AgentModelsReason.nullable(),
  models: z.array(AgentModelOption),
});
export type AgentModelsDto = z.infer<typeof AgentModelsDto>;
// AgentDto: provider: AgentKind; baseUrl: z.string().nullable(); `model` doc comment: "the default model".
// PutAgentRequest.model: AgentModelId (no baseUrl field).
// PutCredentialRequest: { type: CredentialType; value: string(min 1); baseUrl?: AgentBaseUrl | null }  // absent keeps, value sets, null clears

// schemas/rules.ts
// RuleDto gains model: z.string().nullable()
// ruleCommon (both create kinds) gains agentId: Id.optional(), model: AgentModelId.nullable().optional()
// UpdateRuleRequest gains agentId: Id.optional(), model: AgentModelId.nullable().optional()

// routes.ts
routes.agents.models = { method: 'GET', path: '/api/agents/:agentId/models', params: z.object({ agentId: z.uuid() }), response: AgentModelsDto };
```

- Produces (db, `packages/db/src/schema/app.ts`): `agents.baseUrl` (`base_url text null`, check `agents_base_url_check`: `base_url is null or (base_url like 'https://%' and char_length(base_url) <= 2048)`); `rules.model` (`model text null`, check `rules_model_check`: `model is null or char_length(model) between 1 and 200`); `runs.model` (`model text null`, no check).
- Produces (web): `agentModelsFixtures: Record<'live' | 'noCredential' | 'unreachable' | 'rejected' | 'empty' | 'disabled', AgentModelsDto>` in `apps/web/src/mocks/dto/agentModels.ts`; `live` holds the board's ids `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `claude-opus-4-1-20250805`; every fallback holds `opus`, `sonnet`, `haiku`.

- [x] **Step 1: Write the failing contract tests**

In `net.test.ts`: `isBlockedIp` is true for `10.0.0.1`, `172.16.0.1`, `172.31.255.255`, `192.168.1.1`, `127.0.0.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `::1`, `::`, `fc00::1`, `fd12::1`, `fe80::1`, `::ffff:127.0.0.1`, `::ffff:7f00:1`; false for `8.8.8.8`, `172.32.0.1`, `100.128.0.1`, `2606:4700::1111`, `gateway.harbor-labs.com`.

In `agents.test.ts`, `describe('AgentModelId')`: accepts `opus`, `claude-sonnet-4-5-20250929`, `sonnet[1m]`, `vendor/model`, `arn:aws:bedrock:us-east-1:1:x`, `9model`, `a`, `'a'.repeat(200)`; parses `'  my-model-1  '` to `'my-model-1'`; rejects `''`, `'a'.repeat(201)`, `'my model'`, `'a\tb'`, `'-opus'`, `'.opus'`, and every rejection carries the one model message.
`describe('AgentBaseUrl')`: accepts `https://gateway.harbor-labs.com`, `https://gateway.harbor-labs.com/v1/anthropic`, and `'https://gateway.harbor-labs.com/' + 'a'.repeat(2016)` (2048 chars); rejects `http://gateway.harbor-labs.com`, `https://user:pass@gateway.harbor-labs.com`, `https://gateway.harbor-labs.com/v1?key=1`, `https://gateway.harbor-labs.com/v1#top`, the 2049-char value, `https://localhost`, `https://app.localhost`, `https://10.0.0.1`, `https://172.16.0.1`, `https://192.168.1.1`, `https://127.0.0.1`, `https://169.254.169.254`, `https://100.64.0.1`, `https://0.0.0.0`, `https://2130706433`, `https://0x7f.0.0.1`, `https://[::1]`, `https://[::ffff:127.0.0.1]`, `not a url`.
`PutCredentialRequest`: `baseUrl` absent, `null`, and a valid string parse; an invalid one fails with path `['baseUrl']`. `PutAgentRequest.safeParse({ model: 'my model', timeoutSeconds: 60 })` fails with path `['model']`. `AgentDto` parses with `baseUrl: null` and `provider: 'claude'`. `AgentModelsDto` parses `{ source: 'builtin', reason: 'disabled', models: [{ id: 'opus', label: 'opus' }] }`.

In `rules.test.ts`: `CreateRuleRequest` accepts `model: null`, `model: 'haiku'` and an `agentId` uuid on both kinds; rejects `model: '-opus'`; `UpdateRuleRequest` accepts `{ model: null }` and `{ agentId: <uuid> }`.

In `routes.test.ts`: change the route count to `45` and assert `flat['agents.models']` matches `{ method: 'GET', path: '/api/agents/:agentId/models' }`.

- [x] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/contracts test`
Expected: FAIL (`isBlockedIp`, `AgentModelId`, `AgentBaseUrl`, `AgentModelsDto` not exported; route count 44).

- [x] **Step 3: Implement the contracts**

`isBlockedIp`: parse IPv4 to a 32-bit number and IPv6 (with `::` compression and an embedded dotted tail) to 8 hextets, then compare against the CIDR lists. `isAllowedAgentBaseUrl`: `new URL(raw)` in a try; require `protocol === 'https:'`, empty `username` and `password`, and no `?` or `#` anywhere in `raw`; reject `hostname === 'localhost'` or ending in `.localhost`; strip `[`/`]` from `hostname` and reject when `isBlockedIp` is true (the WHATWG parser already normalizes `2130706433` and `0x7f.0.0.1` to `127.0.0.1`). Export `net.ts` from `index.ts`.

- [x] **Step 4: Run the contract tests**

Run: `pnpm --filter @agentdesk/contracts test`
Expected: PASS.

- [x] **Step 5: Write the failing migration test**

In `migrate.int.test.ts`, `it('the agent model routing migration only adds columns and checks: no row writes, no policy or grant changes')`, in the style of the 0015 test: the SQL text has no `UPDATE`, `INSERT`, `DELETE`, `POLICY` or `GRANT`; after migrating, inserting an agent with `base_url = 'http://x'` and one with `char_length(base_url) = 2049` violates `agents_base_url_check`; a rule with `model = repeat('a', 201)` or `''` violates `rules_model_check`; a run row accepts `model = null`.

- [x] **Step 6: Edit the schema and generate the migration**

Add the three columns and two checks to `packages/db/src/schema/app.ts`. Run `pnpm --filter @agentdesk/db db:generate --name agent_model_routing`. Read the SQL and rewrite each `ADD CONSTRAINT` as `... NOT VALID;` followed by `VALIDATE CONSTRAINT`, as `0012_rule_custom_prompt.sql` does.

- [x] **Step 7: Run the db tests**

Run: `pnpm --filter @agentdesk/db test`
Expected: PASS.

- [x] **Step 8: Keep every consumer compiling**

- `agents.service.ts` `toDto`: `provider: AgentKind.parse(row.provider)`, `baseUrl: row.baseUrl`.
- `rules.service.ts` `toDto`: `model: row.model`.
- `agents.int.test.ts` and `rules.int.test.ts`: add `baseUrl: null` / `model: null` to the DTOs they compare.
- Web: `baseUrl: null` in `mocks/dto/agents.ts` and in the agent the `projects.create` handler builds; `model: null` in `mocks/dto/rules.ts`; the `rules.create` handler stores `agentId: body.agentId ?? <project agent id>` and `model: body.model ?? null`, `rules.update` applies `body.model` and `body.agentId` when present; a stub `'agents.models'` handler that 404s an unknown agent, checks the project is visible like `agents.putCredential`, and returns `agentModelsFixtures.live`; add `[AgentModelsDto, Object.values(agentModelsFixtures)]` to the fixture-parse test; add `baseUrl`/`model` to the literals in `features/desk/map.test.ts`.
- `rules.form.ts`: `RuleValues` omits `agentId` and `model` from the contract type (Task 14 adds them to the form).

- [x] **Step 9: Typecheck and test the touched packages**

Run: `pnpm typecheck && pnpm --filter @agentdesk/api test -- agents rules && pnpm --filter @agentdesk/web test -- contract map`
Expected: typecheck clean everywhere; tests PASS.

- [x] **Step 10: Commit**

```bash
devbox run fix
git add packages/contracts packages/db apps/api/src/agents/agents.service.ts apps/api/src/rules/rules.service.ts apps/api/test/agents.int.test.ts apps/api/test/rules.int.test.ts apps/web/src/mocks apps/web/src/features/desk/rules.form.ts apps/web/src/features/desk/map.test.ts
git commit -m "feat(contracts): agent kind, model id, API address, model list route and per-rule model"
```

---

### Task 2: Guarded HTTP transport, ADR and security docs

**Depends on:** Task 1

**Files:**

- Create: `packages/core/src/net/guarded-http.ts`
- Create: `packages/core/test/net/guarded-http.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `docs/adr/0026-agent-adapters-for-models-and-endpoint.md`
- Modify: `docs/adr/README.md`
- Modify: `docs/conventions/security.md`
- Modify: `docs/Agent Desk — Architecture (PoC).md`

**Interfaces:**

- Consumes: `isBlockedIp` (Task 1).
- Produces (exported from `@agentdesk/core`):

```ts
export const GUARDED_TIMEOUT_MS = 5000;
export const GUARDED_MAX_BYTES = 1_000_000;
export type GuardedHttpErrorKind = 'blocked_address' | 'redirect' | 'timeout' | 'too_large' | 'network' | 'bad_json';
/** Message is `guarded http: <kind>`; never a URL query, header, body or cause text. */
export class GuardedHttpError extends Error { readonly kind: GuardedHttpErrorKind; }
/** undici Agent whose connect.lookup rejects any resolved address for which isBlockedIp is true. `lookup` is a test seam. */
export function createGuardedAgent(opts?: { lookup?: typeof import('node:dns').lookup }): import('undici').Agent;
export interface GuardedGetOptions {
  headers: Record<string, string>;
  dispatcher?: import('undici').Dispatcher; // default: a shared createGuardedAgent()
  timeoutMs?: number;                         // default GUARDED_TIMEOUT_MS
  maxBytes?: number;                          // default GUARDED_MAX_BYTES
}
/** GET returning the status and parsed JSON. Refuses non-https, localhost and blocked IP-literal hosts before connecting; a 3xx is `redirect`. */
export function guardedGetJson(url: URL, opts: GuardedGetOptions): Promise<{ status: number; json: unknown }>;
```

- [x] **Step 1: Write the failing tests**

With undici `MockAgent` (`disableNetConnect()`) passed as `dispatcher`:
- `it('returns the status and JSON of a 200')`.
- `it('a 302 is a redirect error and the Location is not fetched')`: `kind === 'redirect'`, the mock for the target has no call.
- `it('a reply slower than the timeout is a timeout error')`: `timeoutMs: 50`, reply delayed 200 ms → `kind === 'timeout'`.
- `it('a body over the cap is too_large')`: `maxBytes: 10`, 11-byte body.
- `it('a non-JSON body is bad_json and the error message does not contain the body')`.
- `it('refuses http, localhost and blocked IP literals without connecting')`: `http://gw.example.com`, `https://localhost`, `https://127.0.0.1`, `https://[::1]`, `https://[::ffff:10.0.0.1]` → `kind === 'blocked_address'`, no mock call.
- With `createGuardedAgent({ lookup })` where the fake lookup answers `10.0.0.1` (and in a second case `fe80::1`): `it('a name that resolves to a private address is refused at connect time')` → `kind === 'blocked_address'`. The fake lookup means no DNS or socket is used.

- [x] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/core test -- guarded-http`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `guarded-http.ts`**

undici `request` with `signal: AbortSignal.timeout(timeoutMs)` and no redirect interceptor; read the body stream, aborting past `maxBytes`; map undici/abort errors to `GuardedHttpError` kinds by class, never by message text. Export from `src/index.ts`.

- [x] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/core test -- guarded-http`
Expected: PASS.

- [x] **Step 5: Write the docs**

- ADR 0026 (Accepted, 2026-11-19): context (fixed model, no gateway support); decision (agent adapter per kind in `packages/core/src/adapters/agents/`, looked up by `agentAdapterFor(kind)`; the API reads the agent credential only to list models and sends it only to the agent's address through `guardedGetJson`; an address change replaces the credential; the model is frozen on the run at intake; `--model` on the CLI); consequences (adding an agent = adapter + runner command file + CLI in the image; outbound call needs the SSRF guard; `AGENT_MODELS_SOURCE=builtin` for local and e2e). Add the row to `docs/adr/README.md`.
- `security.md` §1: the API reads the agent credential only to list models and sends it only to the agent's own address, through the guarded transport; changing the address drops the saved credential and the same save carries a new one. §8: add "an agent adapter (`packages/core/src/adapters/agents/`) or the guarded transport" to the changes that require security review.
- Architecture doc, "Agent abstraction" row: point to the agent adapter (`agentAdapterFor`) and ADR 0026.

- [x] **Step 6: Commit**

```bash
devbox run fix
git add packages/core/src/net packages/core/test/net packages/core/src/index.ts docs/adr docs/conventions/security.md "docs/Agent Desk — Architecture (PoC).md"
git commit -m "feat(core): SSRF-guarded HTTP transport for agent model lists, with ADR 0026"
```

---

### Task 3: Claude agent adapter

**Depends on:** Task 1, Task 2

**Files:**

- Create: `packages/core/src/adapters/agents/types.ts`
- Create: `packages/core/src/adapters/agents/claude.ts`
- Create: `packages/core/src/adapters/agents/registry.ts`
- Create: `packages/core/test/adapters/agents.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `AgentKind`, `AgentModelOption`, `AgentModelId`, `CredentialType` (Task 1); `guardedGetJson`, `GuardedHttpError` (Task 2).
- Produces (exported from `@agentdesk/core`):

```ts
export type AgentModelsErrorKind = 'unreachable' | 'rejected' | 'invalid';
/** Message is `agent models: <kind>` only. */
export class AgentModelsError extends Error { readonly kind: AgentModelsErrorKind; }
/** Injectable GET; the default is `(url, headers) => guardedGetJson(url, { headers })`. */
export type AgentHttpGet = (url: URL, headers: Record<string, string>) => Promise<{ status: number; json: unknown }>;
export interface AgentAdapter {
  kind: AgentKind;
  builtinModels: readonly AgentModelOption[];                 // claude: opus, sonnet, haiku (label = id)
  credentialEnv(type: CredentialType): string;                // oauth_token → CLAUDE_CODE_OAUTH_TOKEN, api_key → ANTHROPIC_API_KEY
  launchEnv(input: { model: string; baseUrl: string | null }): { name: string; value: string }[];
  listModels(input: { credential: { type: CredentialType; value: string }; baseUrl: string | null }): Promise<AgentModelOption[]>;
}
export const CLAUDE_DEFAULT_BASE_URL = 'https://api.anthropic.com';
export function agentAdapterFor(kind: AgentKind, opts?: { http?: AgentHttpGet }): AgentAdapter;
```

Claude `launchEnv`: `AGENT=claude`; when `model !== ''`, `AGENT_MODEL=<model>` and `ANTHROPIC_MODEL=<model>`; when `baseUrl` is set, `ANTHROPIC_BASE_URL=<baseUrl>`; in that order.
Claude `listModels`: URL = base (`baseUrl ?? CLAUDE_DEFAULT_BASE_URL`) with trailing slashes stripped from its path, plus `/v1/models`, query `limit=1000` (and `after_id=<last_id>` on later pages). Body schema: `{ data: { id: string; display_name?: string }[]; has_more?: boolean; last_id?: string | null }`. Label = `display_name ?? id`. Errors: `GuardedHttpError` → `unreachable`; 401/403 → `rejected`; any other non-2xx or a schema failure → `invalid`.

- [x] **Step 1: Write the failing tests**

All HTTP through `agentAdapterFor('claude', { http: (u, h) => guardedGetJson(u, { headers: h, dispatcher: mockAgent }) })` with `MockAgent.disableNetConnect()`:
- `it('sends x-api-key and anthropic-version for an API key')`; `it('sends a Bearer token and the oauth beta header for an OAuth token, and no x-api-key')`.
- `it('lists in the provider order, labels with display_name, and drops duplicates')`: data `m-5`, `m-1`, `m-5`, `m-4` → ids `['m-5', 'm-1', 'm-4']`.
- `it('follows has_more and last_id for at most five pages')`: six pages offered; five requests made; the second request has `after_id=<last id of page 1>`.
- `it('accepts the OpenAI-style gateway body { data: [{ id }] }')`.
- `it('appends to the address path: https://gw.example.com/anthropic/ → /anthropic/v1/models')` (Review Focus 1); `it('with no address calls https://api.anthropic.com/v1/models?limit=1000')`.
- `it('drops ids that are not valid model ids')`: `'bad id'` is not in the result.
- Errors: 401 and 403 → `rejected`; 404 and a `{ foo: 1 }` body → `invalid`; a 302 and a timeout → `unreachable`; a blocked IP-literal address `https://10.0.0.1` → `unreachable`; and for each, `String(err)` contains neither the credential value nor the response body.
- `it('credentialEnv names the runner env per type')`.
- `launchEnv`: with `{ model: 'sonnet[1m]', baseUrl: 'https://gw.example.com/a' }` → exactly `AGENT=claude`, `AGENT_MODEL=sonnet[1m]`, `ANTHROPIC_MODEL=sonnet[1m]`, `ANTHROPIC_BASE_URL=https://gw.example.com/a`; with `baseUrl: null` no `ANTHROPIC_BASE_URL`; with `model: ''` no model entries.
- `it('builtinModels are opus, sonnet and haiku')`.

- [x] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/core test -- agents`
Expected: FAIL (module not found).

- [x] **Step 3: Implement `types.ts`, `claude.ts`, `registry.ts`**

`registry.ts` follows `adapters/registry.ts`: a `switch` on `kind` returning `createClaudeAdapter(http)`. Export the public names from `src/index.ts`.

- [x] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/core test -- agents && pnpm --filter @agentdesk/core typecheck`
Expected: PASS, clean.

- [x] **Step 5: Commit**

```bash
devbox run fix
git add packages/core/src/adapters/agents packages/core/test/adapters/agents.test.ts packages/core/src/index.ts
git commit -m "feat(core): Claude agent adapter for model lists, credential env and launch env"
```

---

### Task 4: Rule model through the API and intake

**Depends on:** Task 1

**Files:**

- Modify: `packages/core/src/router/route-event.ts`
- Modify: `packages/core/src/intake/process-ticket-event.ts`
- Modify: `packages/core/test/intake.int.test.ts`
- Modify: `apps/api/src/rules/rules.service.ts`
- Modify: `apps/api/src/runs/runs.service.ts`
- Modify: `apps/api/test/rules.int.test.ts`
- Modify: `apps/api/test/runs.int.test.ts`

**Interfaces:**

- Consumes: `RuleDto.model`, `CreateRuleRequest`/`UpdateRuleRequest` `agentId` and `model`, columns `rules.model`, `runs.model` (Task 1).
- Produces: `RuleRow` = `Pick<RuleDto, … | 'model'>`; every new run row has `runs.model = rule.model ?? <agents.model of rule.agentId>`, read in the routing transaction; `RunDto.agent.model = run.model ?? agent.model ?? 'unknown'`; `POST /api/projects/:projectId/rules` and `PATCH /api/rules/:ruleId` accept `agentId` (must be an agent of the rule's project, else 422 with pointer `/agentId`, detail "Agent not found in this project") and `model` (`null` resets to the default model).

- [ ] **Step 1: Write the failing tests**

`intake.int.test.ts` (extend `seed` with an optional rule `model`):
- `it('a rule that names a model freezes it on the run')`: rule `model: 'haiku'`, agent `model: 'sonnet'` → run `model === 'haiku'`.
- `it('a rule that follows the default copies the agent default model at intake')`: rule `model: null`, agent `opus` → run `opus`.
- `it('a run already queued keeps its model when the default changes')`: create a run, update `agents.model` to `opus`, re-read → still the old model (BR-33, queued part).

`rules.int.test.ts`:
- `it('create stores model and returns it; absent model is null')`.
- `it('create with agentId of another project is 422 on /agentId and creates nothing')` (a second project in the same org).
- `it('update sets model, null resets it, and agentId of another project is 422 on /agentId')`.
- `it('create with an invalid model is 400 on /model')` (`'my model'`).

`runs.int.test.ts`:
- `it('agent.model is the run model when recorded')` (run `haiku`, agent `sonnet`).
- `it('a run without a model shows the agent current default, and "unknown" when the agent is gone')`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/core test -- intake && pnpm --filter @agentdesk/api test -- rules runs`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `route-event.ts`: add `'model'` to `RuleRow`.
- `process-ticket-event.ts`: map `model: r.model` into `ruleList`; before the insert, when `decision.rule.model === null`, select `agents.model` for `decision.rule.agentId` on `tx`; insert `model`.
- `rules.service.ts` `create`: resolve the agent by `body.agentId` within `projectId` (or the project's agent when absent); 422 via `UnprocessableProblemException([{ pointer: '/agentId', detail: 'Agent not found in this project' }])`; insert `model: body.model ?? null`. `update`: same agent check against the rule's project when `agentId` is present; set `model` when `body.model !== undefined`.
- `runs.service.ts` `toListItem`: `model: row.model ?? agent?.model ?? 'unknown'`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/core test -- intake router && pnpm --filter @agentdesk/api test -- rules runs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add packages/core/src/router packages/core/src/intake packages/core/test/intake.int.test.ts apps/api/src/rules apps/api/src/runs apps/api/test/rules.int.test.ts apps/api/test/runs.int.test.ts
git commit -m "feat(api): per-rule model and agent, frozen on the run at intake"
```

---

### Task 5: Runner passes `--model` and prints the launch line

**Depends on:** Task 2

**Files:**

- Modify: `images/runner/agents/claude/commands.sh`
- Modify: `images/runner/entrypoint.sh`
- Modify: `images/runner/test/entrypoint.test.ts`
- Modify: `docs/conventions/security.md` (only if the check in Step 5 finds the override)

**Interfaces:**

- Consumes: env `AGENT`, `AGENT_MODEL`, `ANTHROPIC_BASE_URL` as Task 3's `launchEnv` sets them (names fixed by the spec).
- Produces: `AGENT_START_CMD='exec claude --permission-mode bypassPermissions ${AGENT_MODEL:+--model "$AGENT_MODEL"} "$PROMPT"'`, `AGENT_RESUME_CMD='exec claude --permission-mode bypassPermissions ${AGENT_MODEL:+--model "$AGENT_MODEL"} --continue'`, `AGENT_ENDPOINT_URL="${ANTHROPIC_BASE_URL:-}"` in `commands.sh`; `entrypoint.sh` prints `agentdesk: agent <AGENT_DIR> model <AGENT_MODEL or default> endpoint <origin of AGENT_ENDPOINT_URL or default>` once, right before it starts the agent's tmux session, in fresh and resume modes, with `printf '%s'`-style quoting.

- [ ] **Step 1: Write the failing runner tests**

In `entrypoint.test.ts`:
- Update `normal mode starts the agent with the prompt command` and the resume test to the new command strings.
- `it('start and resume pass --model as one argv element, also with [1m]')`: run each command string with `bash -c` and a stub `claude` that prints its argv as JSON, env `AGENT_MODEL='sonnet[1m]'`, `PROMPT='hi there'` → argv contains `'--model', 'sonnet[1m]'` adjacent and `'hi there'` as one element.
- `it('passes no --model when AGENT_MODEL is empty')`.
- `it('prints the launch line with the address origin')`: `ANTHROPIC_BASE_URL='https://gateway.harbor-labs.com/v1/anthropic'`, `AGENT_MODEL='haiku'` → stdout has `agentdesk: agent claude model haiku endpoint https://gateway.harbor-labs.com`.
- `it('prints endpoint default and model default when unset')` → `agentdesk: agent claude model default endpoint default`.
- `it('the launch line is printed on resume too')`.
- `it('a model value is printed, never evaluated')`: `AGENT_MODEL='$(touch pwned)'` → no `pwned` file and the line shows the literal text.
- Make sure the tmux shell sees `AGENT_MODEL` the way it sees `PROMPT` (assert with the existing env-capture helper).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/runner test -- entrypoint`
Expected: FAIL.

- [ ] **Step 3: Implement**

`commands.sh` as above. In `entrypoint.sh`, compute the origin with parameter expansion only (`scheme="${url%%://*}"`, `rest="${url#*://}"`, `origin="$scheme://${rest%%/*}"`), and print with `printf 'agentdesk: agent %s model %s endpoint %s\n' …`. Pass `AGENT_MODEL` into the tmux session env alongside `PROMPT`. Update the header comment's env list.

- [ ] **Step 4: Run the runner tests**

Run: `pnpm --filter @agentdesk/runner test`
Expected: PASS.

- [ ] **Step 5: Check the settings override (spec Agent call)**

With the Claude Code version pinned in `images/runner/Dockerfile`, check (its docs or a manual run of that version) whether a repo's `.claude/settings.json` `env` block can override `ANTHROPIC_BASE_URL`. If it can, add one line to `security.md` §4 or §5 naming it a known risk that needs the planned egress proxy, and say so in the PR. If it cannot, say that in the PR. Do not fix it here.

- [ ] **Step 6: Commit**

```bash
devbox run fix
git add images/runner docs/conventions/security.md
git commit -m "feat(runner): pass the run model with --model and print the launch line"
```

---

### Task 6: Worker launches with the adapter env

**Depends on:** Task 1, Task 3

**Files:**

- Modify: `apps/worker/src/activities/run.activities.impl.ts`
- Modify: `apps/worker/test/run.activities.int.test.ts`
- Modify: `packages/core/src/kube/job-spec.ts`
- Modify: `packages/core/test/kube/job-spec.test.ts`
- Modify: `packages/core/src/kube/fake-pod.mjs`
- Modify: `packages/core/test/kube/fake-pod.test.ts`
- Modify: `packages/core/test/kube/fake-gateway.test.ts` (`model:` → `agentEnv:` in its `buildRunJob` call)
- Modify: `apps/worker/test/reconcile.int.test.ts` (same)

**Interfaces:**

- Consumes: `runs.model`, `agents.baseUrl`, `AgentKind` (Task 1); `agentAdapterFor`, `AgentAdapter.credentialEnv`, `AgentAdapter.launchEnv` (Task 3).
- Produces: `RunJobInput.agentEnv: { name: string; value: string }[]` replaces `RunJobInput.model` (literal env values, appended to the common env in both fresh and resume Jobs; the `ANTHROPIC_MODEL` line in `buildRunJob` goes). `RunDetails` gains `agentKind: AgentKind | null` and `baseUrl: string | null`; `RunDetails.model = runs.model ?? agents.model ?? ''`. `CREDENTIAL_ENV` is removed from the worker. The fake pod's first log line, fresh and resumed, is `agentdesk: agent claude model <AGENT_MODEL or default> endpoint <new URL(ANTHROPIC_BASE_URL).origin or default>`.

- [ ] **Step 1: Write the failing tests**

- `job-spec.test.ts`: `it('adds agentEnv entries verbatim, in order, to fresh and resume Jobs')`; `it('has no ANTHROPIC_BASE_URL unless agentEnv carries it')`; `it('a model from agentEnv is always set on the container')` (spec Testing: "a model is always set").
- `fake-pod.test.ts`: `it('logs the launch line first, with the address origin')` (`AGENT_MODEL=haiku`, `ANTHROPIC_BASE_URL=https://gateway.harbor-labs.com/v1/anthropic` → first line `agentdesk: agent claude model haiku endpoint https://gateway.harbor-labs.com`); `it('logs endpoint default without an address')`; `it('a resumed pod logs the launch line first too')`.
- `run.activities.int.test.ts`: `it('the Job env carries the run model, not the agent default')` (run `haiku`, agent `opus` → `AGENT_MODEL=haiku`); `it('a resume after the default model changed keeps the run model')`; `it('a resume reads the agent address fresh')` (set `agents.base_url` before resume → resumed Job env has the new `ANTHROPIC_BASE_URL`; clear it → none); `it('a run without a recorded model uses the agent default')`; `it('the run Secret key comes from the adapter')` (`api_key` → `ANTHROPIC_API_KEY`).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/core test -- job-spec fake-pod && pnpm --filter @agentdesk/worker test -- run.activities.int`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `details()`: select `runModel: runs.model`, `agentModel: agents.model`, `agentKind: agents.provider`, `baseUrl: agents.baseUrl`; parse the kind with `AgentKind.safeParse` (unknown → `ApplicationFailure.nonRetryable('unknown agent kind')`, null stays null).
- Replace `credentialEnv(ctx)` with a stored-credential read (`{ type, value } | null`) used by `redactionList` (values only) and by `createRunSecretAndJob`, which maps it through `agentAdapterFor(kind).credentialEnv(type)`. A null kind with a credential cannot occur (no agent means no credential); keep the existing "no credential" failures.
- `createRunSecretAndJob`: `agentEnv: adapter.launchEnv({ model: d.model, baseUrl: d.baseUrl })`.
- `fake-pod.mjs`: log the launch line before anything else in both branches; update its header comment.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/core test -- kube && pnpm --filter @agentdesk/worker test && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/worker packages/core/src/kube packages/core/test/kube
git commit -m "feat(worker): launch runs with the agent adapter env and the run model"
```

---

### Task 7: API agent address, credential order and model list route

**Depends on:** Task 1, Task 3

**Files:**

- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/test/config.test.ts`
- Modify: `.env.example`
- Modify: `turbo.json`
- Create: `apps/api/src/agents/agent-http.provider.ts`
- Modify: `apps/api/src/agents/agents.service.ts`
- Modify: `apps/api/src/agents/agents.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/helpers/app.ts`
- Modify: `apps/api/test/agents.int.test.ts`
- Modify: `apps/api/src/audit/redact-body.test.ts`

**Interfaces:**

- Consumes: `PutCredentialRequest.baseUrl`, `AgentModelsDto`, `routes.agents.models`, `agents.baseUrl` (Task 1); `agentAdapterFor`, `AgentHttpGet`, `AgentModelsError` (Task 3); `credentialSecretName`, `SecretStore` (existing).
- Produces:
  - `Config.AGENT_MODELS_SOURCE: 'live' | 'builtin'` (default `live`, blank → default).
  - `AGENT_HTTP` injection token (`AgentHttpGet`, default `(u, h) => guardedGetJson(u, { headers: h })`) in `agent-http.provider.ts`; the test app accepts `options.agentHttp?: AgentHttpGet` to override it.
  - `AgentsService.models(org: OrgContext, agentId: string): Promise<AgentModelsDto>` behind `GET /api/agents/:agentId/models`.
  - `AgentsService.putCredential` with `baseUrl !== undefined`: (1) one `withOrg` transaction sets `base_url` (`null` clears) and nulls `credential_secret_name`, `credential_type`, `credential_updated_at`, `credential_set_by`; (2) `secrets.delete(name)`; (3) `secrets.put(name, { type, value })`; (4) metadata set again. A failure in (2) or (3) logs the error class only and throws the existing generic "credential store unavailable". Without `baseUrl` the route behaves as today.

`models` order: 404 unless the agent exists in the org (`withOrg`), then `assertProjectVisible(tx, agent.projectId)`; `AGENT_MODELS_SOURCE === 'builtin'` → `{ source: 'builtin', reason: 'disabled', models: builtin }`; credential metadata unset or `secrets.get` null/unparsable → `no_credential`; `listModels` → `[]` gives `empty`, otherwise `{ source: 'live', reason: null, models }`; `AgentModelsError` `rejected` → `rejected`, `unreachable` and `invalid` → `unreachable`, logged with the error class and the address's host only; a `secrets.get` throw → generic 500.

- [ ] **Step 1: Write the failing tests**

- `config.test.ts`: `AGENT_MODELS_SOURCE` defaults to `live`, accepts `builtin`, rejects `other`.
- `agents.int.test.ts` (live source via `env: { AGENT_MODELS_SOURCE: 'live' }`, `agentHttp` a stub or a `MockAgent`-backed `guardedGetJson`):
  - `it('models: live list in provider order')`.
  - `it('models: builtin with reason disabled when the source is builtin, without reading the credential')` (stub http not called).
  - `it('models: no_credential before a credential is saved')`.
  - `it('models: rejected, unreachable and empty fall back to opus, sonnet, haiku and are never a 5xx')`; the response body contains neither the credential value nor upstream text (stub returns `{ error: 'invalid x-api-key sk-test-secret-123' }` with 401).
  - `it('models: another org agent is 404')`.
  - `it('models: sends the saved credential only to the saved address')` (stub records the URL host).
  - `it('putCredential with baseUrl saves the address and the new credential together')` → GET shows `baseUrl` and `credential.set: true`.
  - `it('putCredential with baseUrl null clears the address')`.
  - `it('putCredential with an invalid baseUrl is 400 on /baseUrl and changes nothing')`.
  - `it('a failed Secret write during an address change leaves the new address with no credential')`: secret store `put` throws → 500 without the value; GET shows the new `baseUrl` and `credential.set: false`; the old Secret is gone.
  - `it('putCredential without baseUrl keeps the address')`.
  - `it('PUT agent with an invalid model is 400 on /model')`; `it('PUT agent has no way to change the address')` (a `baseUrl` in the body is ignored and the address is unchanged).
- `redact-body.test.ts`: `it('a credential body with an address keeps baseUrl and drops value')` (spec: the address is not secret and stays in the audit row).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/core test -- config && pnpm --filter @agentdesk/api test -- agents`
Expected: FAIL.

- [ ] **Step 3: Implement**

Config key; `.env.example` gets `AGENT_MODELS_SOURCE=builtin` with a comment that the local stack and e2e never call the provider; add `AGENT_MODELS_SOURCE` to every `passThroughEnv` list in `turbo.json` that has `ENABLE_FAKE_PROVIDER`. Provider, service and controller as above; register the provider in `app.module.ts`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/core test -- config && pnpm --filter @agentdesk/api test && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add packages/core/src/config.ts packages/core/test/config.test.ts .env.example turbo.json apps/api
git commit -m "feat(api): agent API address with credential replacement and live model list"
```

PR note: the API's Kubernetes role must be allowed to `get` Secrets in the app namespace; the chart lives outside this repo, so flag it as an infra follow-up if missing.

---

### Task 8: Web model-list data layer and shared e2e helpers

**Depends on:** Task 1

**Files:**

- Create: `apps/web/src/mocks/msw/agentModels.ts`
- Create: `apps/web/src/mocks/msw/agentModels.test.ts`
- Modify: `apps/web/src/mocks/msw/handlers.ts`
- Modify: `apps/web/src/mocks/msw/db.ts`
- Modify: `apps/web/src/mocks/msw/scenarios.ts`
- Modify: `apps/web/src/mocks/msw/browser.ts`
- Modify: `apps/web/src/mocks/msw/contract.test.ts`
- Modify: `apps/web/src/features/desk/queries.ts`
- Modify: `apps/web/e2e/mock/mock.ts`
- Create: `apps/web/e2e/local/helpers.ts`
- Modify: `apps/web/e2e/local/run.spec.ts`

**Interfaces:**

- Consumes: `AgentModelsDto`, `PutCredentialRequest.baseUrl`, `routes.agents.models`, `agentModelsFixtures` (Task 1).
- Produces:

```ts
// features/desk/queries.ts
deskQueries.agentModels(org: string, agentId: string) // queryKey ['org', org, 'agents', agentId, 'models'], queryFn api.agents.models, staleTime 5 * 60_000

// mocks/msw/agentModels.ts
export type AgentModelsScenario = (
  | { kind: 'live'; ids: string[]; idsByBaseUrl?: Record<string, string[]> } // '' key = no address
  | { kind: 'fallback'; reason: AgentModelsReason }
  | { kind: 'error' }    // HTTP 500 problem
  | { kind: 'pending' }  // never answers
) & { beforeCredentialSave?: AgentModelsScenario };
export const AGENT_MODELS_SCENARIO_KEY = 'agentdesk.mock.agentModels';
/** Default: no credential → builtin/no_credential; credential → agentModelsFixtures.live. A live scenario still answers no_credential while the agent has none. */
export function agentModelsAnswer(agent: AgentDto, scenario: AgentModelsScenario | undefined, credentialSaved: boolean): AgentModelsDto | 'error' | 'pending';

// mocks/msw/scenarios.ts
scenarios.agentModels(agentId: string, scenario: AgentModelsScenario): void

// e2e/mock/mock.ts
export const INVOICER_API_AGENT: string; // ids.agent.invoicerApi
export async function setAgentModels(page: Page, byAgent: Record<string, AgentModelsScenario>): Promise<void>; // addInitScript before the first load

// e2e/local/helpers.ts (moved from run.spec.ts, behaviour unchanged)
export const API: string; export const REPO: string; export const FAKE_STATE_DIR: string;
export async function ok(res: APIResponse, status: number, what: string): Promise<unknown>;
export async function signInAndCreateProject(page: Page): Promise<{ handle: string; projectId: string }>;
export async function commentOnNewTicket(page: Page, handle: string, projectId: string, body: string, author?: string): Promise<string>;
/** Lines of the fake pod's log for a run ([] when none yet). */
export async function podLogLines(runId: string): Promise<string[]>;
```

MSW handlers: `agents.models` answers through `agentModelsAnswer` with the scenario stored in the mock db (cleared by `mockDb.reset()`); `agents.putCredential` applies `baseUrl` (absent keeps, string sets, `null` clears) and marks the credential saved for `beforeCredentialSave`. Invalid `model`/`baseUrl` bodies already get a 400 with the field pointer from the MSW contract layer (`parsePart`), like the API.

- [ ] **Step 1: Write the failing tests**

`agentModels.test.ts`: default answers (no credential → `no_credential` with opus/sonnet/haiku; credential → live fixture); a `live` scenario with `idsByBaseUrl` answers per address; `beforeCredentialSave` applies until a save; `fallback`, `error`, `pending` map as typed.
`contract.test.ts`: `putCredential` with `baseUrl` then `agents.get` shows it; with `null` clears it; `agents.models` for another org's agent is 404.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- agentModels contract`
Expected: FAIL.

- [ ] **Step 3: Implement**

As above. `browser.ts` reads `sessionStorage[AGENT_MODELS_SCENARIO_KEY]` once at start (try/catch, parse as JSON) and calls `scenarios.agentModels` for each entry. Move the helpers out of `run.spec.ts` and import them there; add `podLogLines`.

- [ ] **Step 4: Run the tests and the moved local spec's typecheck**

Run: `pnpm --filter @agentdesk/web test -- agentModels contract && pnpm --filter @agentdesk/web typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/web/src/mocks apps/web/src/features/desk/queries.ts apps/web/e2e
git commit -m "feat(web): model list query, mock scenarios and shared e2e helpers"
```

---

### Task 9: ModelPicker component

**Depends on:** Task 1

**Files:**

- Create: `apps/web/src/components/ModelPicker.tsx`
- Create: `apps/web/src/components/ModelPicker.stories.tsx`
- Create: `apps/web/src/components/ModelPicker.test.tsx`
- Modify: `apps/web/src/components/index.ts`

**Interfaces:**

- Consumes: `AgentModelOption`, `AgentModelsDto`, `AgentModelsReason` (Task 1); `agentModelsFixtures` (Task 1) in stories; `ds` `Field`, `Select`, `TextInput`.
- Produces (exported from `@/components`):

```ts
export type ModelPickerState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'fallback'; reason: AgentModelsReason; host: string | null }
  | { kind: 'error' };
export interface ModelList { models: readonly AgentModelOption[]; state: ModelPickerState }
export const OTHER_MODEL_LABEL = 'Other model…';
export const DEFAULT_MODEL_LABEL = 'Default model';
/** From a TanStack query's status/data and the agent's address (host only when set). */
export function toModelList(query: { status: 'pending' | 'error' | 'success'; data?: AgentModelsDto }, baseUrl: string | null): ModelList;
/** Exact fallback copy per reason (see Agent calls); `unreachable` with a host is the board line. */
export function fallbackNote(reason: AgentModelsReason, host: string | null): string;
export interface ModelPickerProps {
  label: string;                         // 'Default model' | 'Model'
  list: ModelList;
  value: string | null;                  // null = the leading Default model option (only with withDefault)
  onChange(value: string | null): void;
  withDefault?: boolean;                 // rule form
  help?: ReactNode;                      // under the select while a listed model or Default model is picked
  typedHelp?: ReactNode;                 // under the "Other model…" input
  error?: string;                        // field error, marks the active control invalid
}
export function ModelPicker(props: ModelPickerProps): JSX.Element;
```

Behaviour: options are `Default model` (with `withDefault`), then `list.models` in order (the id shown in mono as on the boards, the label as the option's `title`, the id stored), then `Other model…` last. "Other model…" is selected when `value` is a string not in `list.models`, or after the user picks it; picking it calls `onChange('')` and shows a `TextInput` with accessible name "Model name" holding `value`. Picking a listed model hides the input. Loading and error states still offer `Default model` and `Other model…`, with the Agent-call copy. The fallback note uses the `info` icon as on `DeskAgentCustomModel`. The select and input use the `mono` class, as on the boards.

- [ ] **Step 1: Write the failing tests**

`ModelPicker.test.tsx`:
- `it('lists models in order with Other model… last')`; `it('withDefault puts Default model first and maps it to null')`.
- `it('picking Other model… shows the Model name input and onChange gets "")'`; `it('picking a listed model hides the input')`.
- `it('a value not in the list shows Other model… with the value in the input')` (`sonnet` with dated ids; Review Focus 2).
- `it('fallback shows the reason note; unreachable with a host reads "Showing the standard names. The model list at gateway.harbor-labs.com could not be loaded."')`.
- `it('loading and error still allow Other model… and typing')`.
- `it('error marks the input invalid when Other model… is active, else the select')`.
- `toModelList`: pending → loading; error → error; `{ source: 'live' }` → ready; `{ source: 'builtin', reason: 'unreachable' }` with `https://gateway.harbor-labs.com/v1/anthropic` → host `gateway.harbor-labs.com`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- ModelPicker`
Expected: FAIL.

- [ ] **Step 3: Implement the component and stories**

Stories (fed from `agentModelsFixtures`): Live list, Loading, Error, Fallback for each reason (no credential, unreachable with host, unreachable without host, rejected, empty, disabled), Typed model, Long id (200 chars), With default option.

- [ ] **Step 4: Run the tests and build Storybook**

Run: `pnpm --filter @agentdesk/web test -- ModelPicker && pnpm --filter @agentdesk/web build-storybook`
Expected: PASS; Storybook builds.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/web/src/components/ModelPicker.tsx apps/web/src/components/ModelPicker.stories.tsx apps/web/src/components/ModelPicker.test.tsx apps/web/src/components/index.ts
git commit -m "feat(web): ModelPicker with live, fallback, loading, error and typed states"
```

---

### Task 10: Rule form Model field on the desk and setup step 4 screens

**Depends on:** Task 9

**Files:**

- Modify: `apps/web/src/components/RuleForm.tsx`
- Modify: `apps/web/src/components/RuleForm.stories.tsx`
- Modify: `apps/web/src/components/RuleSentence.tsx`
- Modify: `apps/web/src/components/SetupParts.test.tsx`
- Modify: `apps/web/src/components/Composites.test.tsx`
- Modify: `apps/web/src/components/SidePane.stories.tsx`
- Modify: `apps/web/src/screens/DeskRules.tsx`
- Modify: `apps/web/src/screens/Setup4.tsx`
- Modify: `apps/web/src/screens/desk.stories.tsx`
- Modify: `apps/web/src/screens/setup.stories.tsx`
- Modify: `apps/web/src/screens/desk.test.tsx`
- Modify: `apps/web/src/screens/setup.test.tsx`
- Modify: `apps/web/src/app/routes/o.$org.p.$project.desk.rules.tsx`
- Modify: `apps/web/src/app/routes/o.$org.projects.new.$step.tsx`

**Interfaces:**

- Consumes: `ModelPicker`, `ModelList`, `DEFAULT_MODEL_LABEL` (Task 9).
- Produces:

```ts
// RuleSentence.tsx
RuleDraft.model?: string | null; // absent or null = follows the default model; RuleSentence never shows it
// RuleForm.tsx — the agentModel prop is removed; "With agent" options are agent names only
RuleFormProps.modelField?: { list: ModelList; help: ReactNode }; // renders "Model" ModelPicker withDefault after "With agent"
RuleFormProps.errors?: Partial<Record<'command' | 'labels' | 'target' | 'skill' | 'prompt' | 'model', string>>;
// DeskRules.tsx — RulePaneProps / DeskRulesProps: agentModel removed;
RulePaneProps.modelField?: { list: ModelList; defaultModel: string; settingsHref: string };
//   help = "Default model is <mono>{defaultModel}</mono>, set on <a href={settingsHref}>Agent & settings</a>."
// Setup4.tsx — Setup4Props: agentModel removed; Setup4Props.modelList?: ModelList;
//   help = "Default model is the one picked in step 2."
```

- [ ] **Step 1: Write the failing tests**

- `SetupParts.test.tsx`: replace `RuleForm agentModel` with `it('"With agent" shows the agent name only')` → display value `Claude`.
- `Composites.test.tsx`: agents `['Claude']`; `it('the Model field lists Default model, the models, then Other model…')`; `it('a rule model outside the list shows under Other model…')`; `it('a /model error marks the Model field')`.
- `desk.test.tsx`: the DeskRules pane shows the help "Default model is opus, set on Agent & settings." with a link.
- `setup.test.tsx`: Setup4 shows "Default model is the one picked in step 2.".
- A RuleSentence check: a draft with `model: 'haiku'` renders no `haiku` (BR-30).

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- SetupParts Composites desk.test setup.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Remove the `agentModel` prop chain (RuleForm, RulePane, DeskRules, Setup4, and the two routes, which stop passing it). Add `modelField` / `modelList` as above; the routes pass none yet (Tasks 14 and 15 wire them). Update stories to the boards: `DeskRules`, `DeskRulesPrompt`, `DeskRulesPromptNew`, `DeskRulesPromptError` and `Setup4` show "With agent" = `Claude` and the Model field with the board's live list (`DeskRulesPrompt` with `claude-haiku-4-5-20251001` selected, the others `Default model`); RuleForm and SidePane stories use `Claude`.

- [ ] **Step 4: Run tests, Storybook and parity for the changed boards**

Run: `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web build-storybook && pnpm --filter @agentdesk/web parity`
Expected: PASS; parity shows no new drift on `DeskRules*` and `Setup4` (fix drift in code; only Task 11 edits `design/parity-notes.md`).

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/web/src/components apps/web/src/screens apps/web/src/app/routes
git commit -m "feat(web): rule form Model field and agent shown by name only"
```

---

### Task 11: Desk → Agent screen

**Depends on:** Task 9, Task 10

**Files:**

- Modify: `apps/web/src/screens/DeskAgent.tsx`
- Modify: `apps/web/src/components/SecretField.tsx`
- Modify: `apps/web/src/components/SecretField.stories.tsx`
- Modify: `apps/web/src/components/SecretField.test.tsx`
- Modify: `apps/web/src/mocks/types.ts`
- Modify: `apps/web/src/mocks/agent.ts`
- Modify: `apps/web/src/features/desk/agent.form.ts` (only `toAgentSettings`, which builds `AgentSettings`)
- Modify: `apps/web/src/screens/desk.stories.tsx`
- Modify: `apps/web/src/screens/desk.test.tsx`
- Modify: `apps/web/src/screens/storyIds.ts`
- Modify: `apps/web/scripts/parity.mjs`
- Modify: `apps/web/src/test/coverage.test.ts`
- Modify: `design/prototype/project/canvas.json` (add `DeskAgentCustomModel` and `DeskAgentAddressChanged` if the docs PR did not)
- Modify: `design/parity-notes.md`

**Interfaces:**

- Consumes: `ModelPicker`, `ModelList` (Task 9).
- Produces:

```ts
// mocks/types.ts
AgentSettings.baseUrl: string; // '' = provider default
// features/desk/agent.form.ts
toAgentSettings(...) // adds baseUrl: agent.baseUrl ?? ''
// DeskAgent.tsx — new and changed props
DeskAgentProps.modelList?: ModelList;                              // absent → loading
DeskAgentProps.onSaveAgent?(model: string): void | Promise<boolean>; // "Save agent"
DeskAgentProps.savingAgent?: boolean;
DeskAgentProps.modelError?: string;
DeskAgentProps.onReplaceCredential?(type: CredentialType, value: string, baseUrl?: string | null): void | Promise<boolean>;
//   baseUrl undefined = address unchanged; '' typed → null; otherwise the trimmed typed address
DeskAgentProps.addressError?: string;
DeskAgentProps.initialAddress?: string; // stories: the typed address at mount
// SecretField.tsx — optional overrides for the forced replacing state
SecretFieldProps.replacing?: { title: string; note?: string; status?: string; help?: string };
```

Screen behaviour (boards `DeskAgent`, `DeskAgentCustomModel`, `DeskAgentAddressChanged`): "Default model" `ModelPicker` with help "Loaded from the provider. Rules that don't name a model use this one." and typed help "Sent to Claude Code exactly as typed. Rules that don't name a model use this one."; a **Save agent** button calls `onSaveAgent(value)`; an "API address" input (placeholder `https://api.anthropic.com`, mono) with help "Optional. Leave empty for Anthropic's default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only. Changing it needs the credential again." When the typed address (trimmed) differs from `settings.baseUrl`: the address help becomes "Changed from Anthropic's default. It is saved together with the new credential below." (or the Agent-call line for a custom saved address); the credential is forced into replacing with title "Credential needed again", status "Replaced when you save", note "The API address changed. A saved credential is only sent to the address it was saved with, so paste it again for the new one.", help "We test the new token with one small call before saving. The address and the token are saved together; runs already in progress keep the ones they started with."; Test and replace stays disabled while the token is empty; submit calls `onReplaceCredential(type, value, baseUrl)`. Typing the saved value back leaves the replacing state (Review Focus 5).

- [ ] **Step 1: Write the failing tests**

`desk.test.tsx` (screen): `it('Default model lists the live models with the provider note')`; `it('Save agent sends the picked or typed model')`; `it('editing the API address switches the credential to its replacing state with the board texts')`; `it('typing the saved address back leaves the replacing state and sends no baseUrl')`; `it('clearing a saved address sends baseUrl null')`; `it('Test and replace is disabled until a token is typed')`; `it('shows addressError and modelError on their fields')`; `it('no credential shows no "Set … by …" line')`.
`SecretField.test.tsx`: `it('replacing overrides title, status, note and help')`.
`coverage.test.ts`: 36 boards.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- desk.test SecretField coverage`
Expected: FAIL.

- [ ] **Step 3: Implement screen, stories and board registration**

Stories: update `DeskAgent` to the board (live list, empty address); add `DeskAgentCustomModel` (fallback `unreachable`, host `gateway.harbor-labs.com`, saved address `https://gateway.harbor-labs.com/anthropic`, typed model `anthropic/claude-sonnet-4-5`) and `DeskAgentAddressChanged` (`initialAddress` `https://gateway.harbor-labs.com/anthropic`, saved address empty); add state stories Loading model list and Model list failed. Register both new boards in `storyIds.ts` (`boardStories`, canvas order), `parity.mjs` and `canvas.json` together, and update the board count in comments and `coverage.test.ts`.

- [ ] **Step 4: Run tests, Storybook and parity**

Run: `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web build-storybook && pnpm --filter @agentdesk/web parity`
Expected: PASS; drift on the three Desk Agent boards fixed, or recorded in `design/parity-notes.md`.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/web/src/screens apps/web/src/components/SecretField* apps/web/src/mocks/types.ts apps/web/src/mocks/agent.ts apps/web/src/features/desk/agent.form.ts apps/web/scripts/parity.mjs apps/web/src/test/coverage.test.ts design/prototype/project/canvas.json design/parity-notes.md
git commit -m "feat(web): Desk Agent default model picker, Save agent and API address"
```

---

### Task 12: Setup Agent step screen

**Depends on:** Task 9, Task 10

**Files:**

- Modify: `apps/web/src/screens/Setup2.tsx`
- Modify: `apps/web/src/screens/setup.stories.tsx`
- Modify: `apps/web/src/screens/setup.test.tsx`
- Modify: `apps/web/src/app/routes/o.$org.projects.new.$step.tsx` (only the stop-gap props in Step 3)

**Interfaces:**

- Consumes: `ModelPicker`, `ModelList` (Task 9).
- Produces:

```ts
Setup2Draft.model: string;          // unchanged name; now the picker value (typed allowed)
Setup2Draft.baseUrl: string;        // the typed address, trimmed; '' = provider default
Setup2Props.models → removed; Setup2Props.modelList: ModelList;
Setup2Props.baseUrl?: string;       // saved address ('' default)
Setup2Props.errors?: { credential?: string; model?: string; maxConcurrent?: string; baseUrl?: string };
```

Screen (board `Setup2`): "API address" input with help "Optional. Leave empty for Anthropic's default. Runs get it as ANTHROPIC_BASE_URL. Public https addresses only."; "Default model" `ModelPicker` with help "Loaded from the provider. Rules that don't name a model use this one." and the typed help as on Desk → Agent; `baseUrl` error shown on the address field.

- [ ] **Step 1: Write the failing tests**

`setup.test.tsx`: `it('Setup2 shows API address and a Default model picker with Other model… last, not the fixed opus/sonnet list')`; `it('Continue passes the typed address and the picked or typed model')`; `it('a baseUrl error shows on the API address field')`; `it('fallback shows opus, sonnet, haiku with the reason note')`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- setup.test`
Expected: FAIL.

- [ ] **Step 3: Implement screen and stories**

Update the `Setup2` story to the board (live list); add `Setup2Fallback` (no credential) as a state story. Until Task 15 wires the query, the setup route's `AgentStep` passes `modelList={{ models: [{ id: agent.model, label: agent.model }], state: { kind: 'ready' } }}` and `baseUrl={agent.baseUrl ?? ''}` in place of `models`, so the route and its test stay green.

- [ ] **Step 4: Run tests, Storybook and parity**

Run: `pnpm --filter @agentdesk/web test && pnpm --filter @agentdesk/web typecheck && pnpm --filter @agentdesk/web build-storybook && pnpm --filter @agentdesk/web parity`
Expected: PASS; no new drift on `Setup2` (fix it in code).

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/web/src/screens/Setup2.tsx apps/web/src/screens/setup.stories.tsx apps/web/src/screens/setup.test.tsx "apps/web/src/app/routes/o.\$org.projects.new.\$step.tsx"
git commit -m "feat(web): setup Agent step API address and default model picker"
```

---

### Task 13: Desk → Agent wiring

**Depends on:** Task 8, Task 9, Task 11

**Files:**

- Modify: `apps/web/src/features/desk/agent.form.ts`
- Modify: `apps/web/src/features/desk/agent.form.test.ts`
- Modify: `apps/web/src/app/routes/o.$org.p.$project.desk.agent.tsx`
- Modify: `apps/web/src/features/desk/agent.route.test.tsx`

**Interfaces:**

- Consumes: `deskQueries.agentModels`, `scenarios.agentModels` (Task 8); `toModelList` (Task 9); `DeskAgentProps` additions, `AgentSettings.baseUrl` (Task 11).
- Produces:

```ts
// agent.form.ts
/** Saves the default model through agents.put, sending the other fields from a fresh fetch (staleTime 0), as useSaveLimits does. */
export function useSaveAgent(org: string, projectId: string): { save(model: string): Promise<boolean>; saving: boolean; error?: string };
// error from pointer /model
export function useReplaceCredential(org: string, projectId: string, agentId: string): {
  replace(type: CredentialType, value: string, baseUrl?: string | null): Promise<boolean>;
  pending: boolean;
  error?: string;        // /value, /type
  addressError?: string; // /baseUrl
};
// on success invalidates deskQueries.agent and deskQueries.agentModels(org, agentId)
```

- [ ] **Step 1: Write the failing tests**

`agent.form.test.ts`: `useSaveAgent` sends `{ model, timeoutSeconds, maxTurns? }` from the fresh agent and no keep times (BR-8); `useReplaceCredential` sends `baseUrl` only when given.
`agent.route.test.tsx` (MSW node): `it('the Default model picker shows the live list')`; `it('Save agent saves the typed model exactly and shows it after returning')`; `it('a saved model not in the live list shows under Other model… and Save agent keeps it')` (Review Focus 2); `it('an address change plus token saves both and the model list reloads without a page reload')` (scenario `idsByBaseUrl`); `it('a /baseUrl problem shows on the API address field')`; `it('a /model problem shows on the Default model field')`; `it('the models request failing shows the error state and Other model… still works')`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- agent.form agent.route`
Expected: FAIL.

- [ ] **Step 3: Implement the hooks and the route**

The route reads `useQuery(deskQueries.agentModels(org, agent.id))` (not suspense, so the screen shows loading), passes `modelList`, `onSaveAgent`, `savingAgent`, `modelError`, `onReplaceCredential`, `addressError`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/web test -- agent && pnpm --filter @agentdesk/web typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/web/src/features/desk/agent.form.ts apps/web/src/features/desk/agent.form.test.ts "apps/web/src/app/routes/o.\$org.p.\$project.desk.agent.tsx" apps/web/src/features/desk/agent.route.test.tsx
git commit -m "feat(web): wire the Desk Agent model list, Save agent and address change"
```

---

### Task 14: Desk → Routing rules wiring

**Depends on:** Task 8, Task 9, Task 10

**Files:**

- Modify: `apps/web/src/features/desk/rules.form.ts`
- Modify: `apps/web/src/features/desk/rules.form.test.ts`
- Modify: `apps/web/src/app/routes/o.$org.p.$project.desk.rules.tsx`
- Modify: `apps/web/src/features/desk/rules.route.test.tsx`

**Interfaces:**

- Consumes: `deskQueries.agentModels` (Task 8); `toModelList` (Task 9); `RuleDraft.model`, `RulePaneProps.modelField`, `RuleFormProps.errors.model` (Task 10); contract `agentId`/`model` (Task 1).
- Produces: `RuleValues` gains `agentId: string` and `model: string | null`; `toCreateRequest` sends both; `changedFields` sends `agentId` and `model` only when changed (`null` when reset to the default); `SCREEN_FIELD.model = 'model'`, `RULE_POINTERS['/model'] = 'model'`, `RULE_POINTERS['/agentId'] = 'agentId'` (shown in the form banner, no screen field); `SCHEMA_MESSAGE.model` = the contract's model message. `useRuleForm(org, projectId, { initial, defaultSkill, defaultAgentId, onSaved })` — `defaultAgentId: string` is the project agent's id for a new rule.

- [ ] **Step 1: Write the failing tests**

`rules.form.test.ts`: `it('changedFields sends only model when only the model changed')` and `it('Default model sends model null')` (Review Focus 4); `it('changing agentId keeps the model')` (BR-28, lowest layer: see Agent calls); `it('an invalid typed model is a model field error before any request')`.
`rules.route.test.tsx`: `it('the Model field lists Default model, the agent models, Other model…, with the default model help')`; `it('saving a typed model stores it trimmed and reopening shows it under Other model…')`; `it('a /model problem lands on the Model field')`; `it('the rules list row and the sentence show no model')`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- rules.form rules.route`
Expected: FAIL.

- [ ] **Step 3: Implement**

The route builds `modelField: { list: toModelList(useQuery(deskQueries.agentModels(org, values.agentId)), agent.baseUrl), defaultModel: agent.model, settingsHref: <desk agent path> }` and maps `d.model` through `form.change`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/web test -- rules && pnpm --filter @agentdesk/web typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add apps/web/src/features/desk/rules.form.ts apps/web/src/features/desk/rules.form.test.ts "apps/web/src/app/routes/o.\$org.p.\$project.desk.rules.tsx" apps/web/src/features/desk/rules.route.test.tsx
git commit -m "feat(web): rule form saves its own model or follows the default"
```

---

### Task 15: Setup wizard wiring (Agent step and step 4)

**Depends on:** Task 8, Task 9, Task 10, Task 12

**Files:**

- Modify: `apps/web/src/app/routes/o.$org.projects.new.$step.tsx`
- Modify: `apps/web/src/features/setup/mutations.ts`
- Modify: `apps/web/src/features/setup/setup.route.test.tsx`

**Interfaces:**

- Consumes: `deskQueries.agentModels` (Task 8); `toModelList` (Task 9); `Setup4Props.modelList`, `RuleDraft.model` (Task 10); `Setup2Draft.baseUrl`, `Setup2Props.modelList`, `Setup2Props.baseUrl` (Task 12).
- Produces: `AgentStepInput.baseUrl?: string | null` (sent with the credential only when the address changed: `''` → `null`); AgentStep validation: when `agent.credential.set`, the address changed and the token is empty → `fields.baseUrl = 'Paste the token again to change the API address.'` and no request; `AGENT_POINTERS['/baseUrl'] = 'baseUrl'`; step 4 `toRequest` sends `model` for the first rule (`null` for Default model) and `model: null` for the follow-up; step-4 `RULE_POINTERS['/model'] = 'model'`.

- [ ] **Step 1: Write the failing tests**

`setup.route.test.tsx`: `it('Agent step lists the agent models with Other model… last')`; `it('changing the address with a saved credential and no token shows "Paste the token again to change the API address." and stays')`; `it('address plus token saves both; unchanged address and no token continues without a credential call')`; `it('a typed default model is saved exactly')`; `it('step 4 shows the Model field with "Default model is the one picked in step 2." and saves the picked model')`; `it('the follow-up rule follows the default model')`.

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @agentdesk/web test -- setup.route`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the hardcoded `MODELS` with `toModelList(useQuery(deskQueries.agentModels(org, agent.id)), agent.baseUrl)`; after a credential save, invalidate `deskQueries.agentModels`. Keep the existing local e2e flow working (Token textbox and Continue unchanged).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @agentdesk/web test -- setup && pnpm --filter @agentdesk/web typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
devbox run fix
git add "apps/web/src/app/routes/o.\$org.projects.new.\$step.tsx" apps/web/src/features/setup/mutations.ts apps/web/src/features/setup/setup.route.test.tsx
git commit -m "feat(web): wire the setup model list, API address and step 4 rule model"
```

---

### Task 16: E2E mock — Desk → Agent

**Depends on:** Task 8, Task 13

**Files:**

- Create: `apps/web/e2e/mock/agent-model.spec.ts`

**Interfaces:**

- Consumes: `setAgentModels`, `INVOICER_API_AGENT`, `ORG`, `INVOICER_API` (Task 8); the Desk → Agent page (Task 13).

Covers: BR-1 (TC-1.1, TC-1.2), BR-2 (TC-2.1–TC-2.4), BR-3 (TC-3.1–TC-3.3), BR-4 (TC-4.1–TC-4.3), BR-5 (TC-5.1–TC-5.3), BR-9 (TC-9.1, TC-9.2), BR-10 (TC-10.1, TC-10.2), BR-13 (TC-13.1–TC-13.3), BR-17 (TC-17.1, TC-17.2). BR-10's duplicates and five-page cap are proven in Task 3 (spec: no screen can feed provider pages).

- [ ] **Step 1: Write the specs**

One `test` per TC, titled `TC-<n.m> <what is seen>`. Set the scenario with `setAgentModels` before the first `page.goto`; reach saved states (address, typed model, credential) through the UI and client-side navigation, never a second `goto` (it reseeds). TC-2.1 and TC-17.1 use `{ kind: 'live', ids, beforeCredentialSave: { kind: 'fallback', reason: 'no_credential' } }` or a fallback scenario; TC-9.1 `pending`; TC-9.2 `error`; TC-17.2 `idsByBaseUrl`. Assert exact text only where the spec gives it (TC-1.1 note, TC-3.1, TC-4.1, TC-13.1); elsewhere assert the options and that a note is present with no error state (spec Q1, Q2).

- [ ] **Step 2: Run the new spec**

Run: `pnpm --filter @agentdesk/web exec vite build --mode mock && pnpm --filter @agentdesk/web exec playwright test e2e/mock/agent-model.spec.ts`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
devbox run fix
git add apps/web/e2e/mock/agent-model.spec.ts
git commit -m "test(web): mock e2e for the Desk Agent model picker and address change"
```

---

### Task 17: E2E mock — rule form and setup wizard

**Depends on:** Task 8, Task 14, Task 15

**Files:**

- Create: `apps/web/e2e/mock/rule-model.spec.ts`
- Create: `apps/web/e2e/mock/setup-agent.spec.ts`

**Interfaces:**

- Consumes: `setAgentModels` (Task 8); the rules page (Task 14) and the wizard (Task 15).

Covers: BR-18 (TC-18.1, TC-18.2), BR-19 (TC-19.1–TC-19.4), BR-20 (TC-20.1–TC-20.3), BR-22 (TC-22.1–TC-22.3), BR-23 (TC-23.1, TC-23.2), BR-24 (TC-24.1–TC-24.4), BR-29 (TC-29.3–TC-29.5), BR-30 (TC-30.1–TC-30.3). BR-28 (TC-28.1–TC-28.3) is not run here: the app offers one agent per project and no route lists agents, so a second agent cannot be picked; it is proven in Task 14 (`changing agentId keeps the model`) and keyed by agent id in the query (see Agent calls and OPEN).

- [ ] **Step 1: Write the specs**

`setup-agent.spec.ts`: BR-18, BR-19, BR-20 (wizard reached by clicks from the seed; TC-20 resumes a seeded setup project with a credential, or saves one in the Agent step first). `rule-model.spec.ts`: BR-22, BR-23 (desk and step 4), BR-24, BR-29 mock cases, BR-30. One `test` per TC, titled `TC-<n.m> …`.

- [ ] **Step 2: Run the new specs**

Run: `pnpm --filter @agentdesk/web exec vite build --mode mock && pnpm --filter @agentdesk/web exec playwright test e2e/mock/rule-model.spec.ts e2e/mock/setup-agent.spec.ts`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
devbox run fix
git add apps/web/e2e/mock/rule-model.spec.ts apps/web/e2e/mock/setup-agent.spec.ts
git commit -m "test(web): mock e2e for the rule Model field and the setup Agent step"
```

---

### Task 18: E2E local — Desk → Agent

**Depends on:** Task 7, Task 8, Task 13

**Files:**

- Create: `apps/web/e2e/local/agent-settings.spec.ts`

**Interfaces:**

- Consumes: `signInAndCreateProject`, `commentOnNewTicket`, `ok`, `FAKE_STATE_DIR` (Task 8); the agent API (Task 7); the Desk → Agent page (Task 13).

Covers: BR-2 (TC-2.5), BR-6 (TC-6.1–TC-6.4), BR-7 (TC-7.1–TC-7.9), BR-8 (TC-8.1), BR-11 (TC-11.1), BR-12 (TC-12.1–TC-12.9), BR-14 (TC-14.1–TC-14.3), BR-15 (TC-15.1, TC-15.2), BR-16 (TC-16.1–TC-16.3).

- [ ] **Step 1: Write the specs**

One `test` per TC (TC-7.x and TC-12.x may loop over values inside one test each), titled `TC-<n.m> …`. The stack runs with `AGENT_MODELS_SOURCE=builtin` from `.env`, so lists are opus/sonnet/haiku with reason disabled. BR-8 opens two pages in one context. BR-16: with an address and credential saved, find `<FAKE_STATE_DIR>/secrets/*-agent-<agentId>.json`, replace it with a directory of that name holding one file, then change the address, paste a token and Test and replace; after reload expect the new address and no "Set … by …" line; TC-16.2 triggers the rule with `commentOnNewTicket` and asserts the run never reaches `running`/`idle` and ends `failed`; TC-16.3 removes the directory, saves a token and asserts the run starts. TC-15.2 asserts Test and replace is disabled with an empty token (board `DeskAgentAddressChanged`).

- [ ] **Step 2: Run the new spec against the running stack**

Run: `devbox run dev-bg` (if not up), then `pnpm --filter @agentdesk/web exec playwright test e2e/local/agent-settings.spec.ts`
Expected: all PASS. If the stack cannot start, say so in the PR and list the spec as written but not run.

- [ ] **Step 3: Commit**

```bash
devbox run fix
git add apps/web/e2e/local/agent-settings.spec.ts
git commit -m "test(web): local e2e for default model, API address and credential replacement"
```

---

### Task 19: E2E local — rules and setup wizard

**Depends on:** Task 4, Task 7, Task 8, Task 14, Task 15

**Files:**

- Create: `apps/web/e2e/local/rule-model.spec.ts`

**Interfaces:**

- Consumes: `signInAndCreateProject`, `ok` (Task 8); rules API (Task 4); agent API (Task 7); rules page (Task 14); wizard (Task 15).

Covers: BR-19 (TC-19.5), BR-21 (TC-21.1, TC-21.2), BR-24 (TC-24.5), BR-25 (TC-25.1, TC-25.2), BR-26 (TC-26.1), BR-27 (TC-27.1), BR-29 (TC-29.1, TC-29.2, TC-29.6).

- [ ] **Step 1: Write the specs**

One `test` per TC, titled `TC-<n.m> …`. BR-21 drives the wizard itself (not `signInAndCreateProject`) up to the Agent step, then leaves to the project list and resumes. Rules are opened from Desk → Routing rules; reload checks reopen the rule.

- [ ] **Step 2: Run the new spec against the running stack**

Run: `pnpm --filter @agentdesk/web exec playwright test e2e/local/rule-model.spec.ts`
Expected: all PASS (or listed as written but not run, with the reason).

- [ ] **Step 3: Commit**

```bash
devbox run fix
git add apps/web/e2e/local/rule-model.spec.ts
git commit -m "test(web): local e2e for rule models and the setup Agent step"
```

---

### Task 20: E2E local — runs start with the configured model and address

**Depends on:** Task 4, Task 6, Task 7, Task 8, Task 13

**Files:**

- Create: `apps/web/e2e/local/run-model.spec.ts`

**Interfaces:**

- Consumes: `signInAndCreateProject`, `commentOnNewTicket`, `podLogLines`, `ok`, `FAKE_STATE_DIR` (Task 8); rule model API (Task 4); fake pod launch line and worker env (Task 6); address save (Task 7); Desk → Agent page (Task 13).

Covers: BR-31 (TC-31.1, TC-31.2), BR-32 (TC-32.1, TC-32.2), BR-33 (TC-33.1, TC-33.2; the still-queued run is proven in Task 4), BR-34 (TC-34.1), BR-35 (TC-35.1–TC-35.3), BR-36 (TC-36.1, TC-36.2), BR-37 (TC-37.1–TC-37.3).

- [ ] **Step 1: Write the specs**

One `test` per TC, titled `TC-<n.m> …`. Set a rule's model with `PATCH /api/rules/:ruleId` (`RuleDto` parse) and the default model and address through Desk → Agent. Read the model from Run detail and `GET /api/runs/:runId` (`RunDto.agent.model`); read the launch line as `(await podLogLines(runId))[0]`. BR-34/BR-36: pause with a `--fake-fail` comment, wait for `paused`, change the default model or the address, click Resume, wait for the new pod, and read its first log line. BR-37: create a run, then clear `runs.model` (TC-37.3 also `runs.agent_id`) with `execFile('docker-compose', ['-f', composeFile, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'agentdesk', '-v', 'ON_ERROR_STOP=1'])`, the SQL with a `:'id'` variable on stdin and the id checked with `z.uuid()` first; `composeFile` = `process.env.AGENTDESK_COMPOSE_FILE` or the repo's `docker-compose.yml`.

- [ ] **Step 2: Run the new spec against the running stack**

Run: `pnpm --filter @agentdesk/web exec playwright test e2e/local/run-model.spec.ts`
Expected: all PASS (or listed as written but not run, with the reason).

- [ ] **Step 3: Commit**

```bash
devbox run fix
git add apps/web/e2e/local/run-model.spec.ts
git commit -m "test(web): local e2e for the run model, launch line and resume"
```

---

## Before saying done (every task)

Run `pnpm typecheck` and `pnpm test` for the packages the task touched (or `devbox run check`) and report the real results; run only the task's own new or changed e2e specs; fill in the PR template and the code-review checklist; label sensitive tasks (1, 2, 3, 5, 6, 7) `review:sensitive`.
