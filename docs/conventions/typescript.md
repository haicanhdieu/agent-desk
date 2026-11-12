# TypeScript guidelines

How we write TypeScript across the monorepo so types stay honest from the HTTP boundary to the database and the Kubernetes Job.
These rules assume the compiler settings in `tsconfig.base.json` and the shared Zod schemas in `packages/contracts`.

**Applies to:** `apps/api`, `apps/worker`, `apps/web`, `packages/contracts`, `packages/core`, `packages/db`, and `scripts/`.
Siblings: [architecture.md](architecture.md) · [backend.md](backend.md) · [database.md](database.md) · [frontend.md](frontend.md) · [testing.md](testing.md) · [security.md](security.md) · [code-review-checklist.md](code-review-checklist.md)

## 1. Compiler and tooling

- **MUST** keep `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` and `isolatedModules` on in `tsconfig.base.json`. _Why: they are the baseline every package already passes._
- **MUST NOT** relax a base flag in a package `tsconfig.json`; add stricter flags only. _Why: one package's loophole leaks through shared types._
- **SHOULD** turn on `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` before the backend grows (planned). _Why: `arr[0]` and `{ x: undefined }` are the two biggest holes left in `strict`._
- **MUST** pass `pnpm typecheck` (turbo `typecheck` in every package) before review. CI gate (planned, see [git-workflow.md](git-workflow.md)).
- **Formatting: Prettier owns it.** Config is `.prettierrc.json` at the repo root (single quotes, print width 120, Prettier defaults otherwise: semicolons, trailing commas, 2-space indent); ignores are in `.prettierignore`, editor basics in `.editorconfig`. **MUST NOT** hand-format code or argue style in review; run `pnpm format` (`devbox run format`) and commit the result. `pnpm format:check` is the first CI gate. `eslint-config-prettier` is in the web ESLint config so lint never fights the formatter. _Why: one formatter means zero style debate and minimal diffs._
- **One-time reformat (planned).** Existing files predate Prettier, so `pnpm format:check` fails on `main` until a single `pnpm format` commit lands after `feat/backend` and `feat/frontend` merge (avoids conflicts). Until then, format only the files you touch: `devbox run fix` before every commit (see [git-workflow.md](git-workflow.md) §7), and never mix repo-wide formatting into a feature PR.
- Lint: the turbo `lint` task exists but no ESLint config is checked in yet. The rules below marked _(lint, planned)_ will be enforced by `typescript-eslint` once added.
- Nest needs `experimentalDecorators` and `emitDecoratorMetadata` in `apps/api` and `apps/worker` only. Those packages **MUST** run through a compiler that emits decorator metadata (`tsc`/SWC), not plain esbuild/`tsx`, or constructor injection by type silently breaks. Prefer explicit `@Inject(TOKEN)` for non-class providers (`DB`, `TEMPORAL_CLIENT`).

## 2. `any`, `!`, and casts

- **MUST NOT** use `any` _(lint, planned: `no-explicit-any`)_. Use `unknown` and narrow. _Why: `any` disables checking for everything it touches, transitively._
- **MUST NOT** use the non-null assertion `!` _(lint, planned)_. Narrow or throw a typed error. _Why: it turns a type error into a production `TypeError`._
- **MUST NOT** use `as` to change a type's shape. Allowed: `as const`, `satisfies`, and `as` on a value just validated by Zod or a type guard in the same function. _Why: casts are unchecked claims._
- **SHOULD** prefer `satisfies` over annotation for config-like literals, as `routes.ts` does. _Why: keeps literal types and still checks the shape._

```ts
// bad
const run = rows[0]!;
const body = req.body as CreateRuleRequest;

// good
const run = rows[0];
if (!run) throw new NotFoundError('run', runId);
const body = CreateRuleRequest.parse(req.body);
```

- An unavoidable escape hatch (third-party typing bug) **MUST** carry `// eslint-disable-next-line <rule> -- <reason + link>`. `@ts-ignore` is forbidden; `@ts-expect-error` with a reason is allowed.

## 3. Boundaries: `unknown` + Zod

Every value that crosses a process boundary is `unknown` until parsed.

- **MUST** parse with a Zod schema at: HTTP bodies/params/query (via `nestjs-zod`, see [backend.md](backend.md)), webhook payloads (inside the adapter), provider API responses, Temporal workflow/activity inputs that come from outside the workflow, env vars (`ConfigSchema`), `jsonb` columns (`outbox`, `payload`, `config`), files read by `FakeStore`, and `JSON.parse` output anywhere. _Why: the type system cannot see across the wire._
- **MUST** take request/response shapes from `@agentdesk/contracts`; **MUST NOT** redeclare them by hand. _Why: one schema drives validation, OpenAPI and the web client._
- **MUST** name a schema and its inferred type identically (the contracts convention): `export const RunDto = z.object({...}); export type RunDto = z.infer<typeof RunDto>;`.
- **SHOULD** use `safeParse` when a failure is an expected outcome (e.g. a webhook we ignore) and `parse` when failure is a bug or a 400.
- **MUST NOT** trust the payload of a `pg_notify` or SSE message; re-read the row (see [backend.md](backend.md) §SSE).

```ts
// bad: shape assumed
const cfg = JSON.parse(row.config);
// good
const cfg = ConnectionConfig.parse(row.config);
```

## 4. Types and modelling

- **SHOULD** model alternatives as discriminated unions with a `kind` field, as `PollResult` and `RouteDecision` do. _Why: exhaustive `switch` catches new cases._
- **MUST** end a `switch` over a union with an exhaustiveness check.

```ts
function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
switch (r.kind) {
  case 'events': ...; break;
  case 'not_modified': ...; break;
  case 'rate_limited': ...; break;
  case 'revoked': ...; break;
  default: assertNever(r);
}
```

- **MUST** derive enum-like unions from the contracts Zod enums (`RunStatus`, `TriggerMode`, `Provider`…) instead of TS `enum`. _(lint, planned: `no-restricted-syntax` on `TSEnumDeclaration`)_. _Why: TS enums don't survive `isolatedModules` cleanly and duplicate the schema._
- **SHOULD** prefer `interface` for object contracts implemented by classes (`BoardAdapter`, `KubeGateway`, `SecretStore`) and `type` for unions and derived types.
- **SHOULD** use `readonly` arrays/props for values that must not be mutated (`FINAL_RUN_STATUSES`).
- **MUST NOT** encode a provider in a type name (`GithubTicket`, `GithubConnection`). Use the generic concept (`Ticket`, `Connection`) and keep provider types private to `packages/core/src/adapters/<provider>/`. _Why: owner rule; GitLab, Bitbucket and Jira come later._

## 5. Modules, exports, imports

- **MUST** use ESM (`"type": "module"`) and named exports. Default exports are allowed only where a tool requires them (Vite/TanStack route files, config files). _Why: grep-able names and safe renames._
- **MUST** import another workspace package only through its package name and `exports` map (`@agentdesk/contracts`, `@agentdesk/contracts/client`), never by relative path into its `src/`. _Why: the `exports` map is the public API._
- **MUST** use `import type` for type-only imports. _Why: required for `isolatedModules`, and keeps runtime graphs small._
- **SHOULD** keep one barrel (`src/index.ts`) per package; **MUST NOT** add barrels inside feature folders. _Why: nested barrels hide cycles and slow tests._
- **MUST NOT** create import cycles between packages. Allowed direction: `contracts` ← `db` ← `core` ← `api`/`worker`; `web` depends on `contracts` only. See [architecture.md](architecture.md).
- `packages/core` and `packages/db` **MUST NOT** import from `@nestjs/*`. _Why: they are framework-neutral so the worker, tests and the future runner can use them._

## 6. Naming

| Thing                       | Convention                                                                      | Example                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Files                       | kebab-case, role suffix where Nest/Temporal has one                             | `projects.controller.ts`, `run.workflow.ts`, `run-status.activity.ts`, `parse-command.ts` |
| Tests                       | `<name>.test.ts` next to source or under `test/` (see [testing.md](testing.md)) | `slug.test.ts`                                                                            |
| Types, classes, Zod schemas | PascalCase; DTO suffix for API shapes                                           | `RunDto`, `CreateRuleRequest`, `KubeGateway`                                              |
| Functions, variables        | camelCase, verb-first for functions                                             | `routeEvent`, `mintWorkspaceToken`                                                        |
| Constants                   | UPPER_SNAKE for module-level fixed values                                       | `POLL_INTERVALS`, `FINAL_RUN_STATUSES`                                                    |
| DI tokens                   | UPPER_SNAKE string/symbol                                                       | `DB`, `TEMPORAL_CLIENT`                                                                   |
| Booleans                    | `is`/`has`/`can` prefix                                                         | `isFinal`, `hasCredential`                                                                |
| JSON fields                 | camelCase (DB stays snake_case, see [database.md](database.md))                 | `pollIntervalSeconds`                                                                     |

- **MUST NOT** use provider names in files, folders, types or functions outside `adapters/<provider>/`. Enum _values_ such as `Provider = 'github'` are data, not names, and are fine.
- **SHOULD** spell units in names: `timeoutSeconds`, `olderThanSeconds`, `expiresAt` (a `Date`). _Why: seconds vs ms bugs._

## 7. Error handling

- **MUST** throw `Error` subclasses, never strings or plain objects. _Why: stack traces and `instanceof`._
- **MUST** use the typed domain errors from `packages/core` (`NotFoundError`, `ConflictError`, `ValidationError`, `ForbiddenError`; planned in `packages/core/src/errors.ts`) for expected failures; the api maps them to problem+json (see [backend.md](backend.md) §Errors).
- **MUST** set `cause` when wrapping: `throw new ProviderError('comment failed', { cause: err })`. _Why: keeps the root error in logs._
- **MUST NOT** swallow errors. Every `catch` either rethrows, converts to a typed error, or handles a _named_ expected case and logs it.

```ts
// bad
try {
  await adapter.comment(p, ref, text);
} catch {}

// good: one known case handled, the rest rethrown
try {
  await client.workflow.start('RunWorkflow', opts);
} catch (err) {
  if (err instanceof WorkflowExecutionAlreadyStartedError) return;
  throw err;
}
```

- **MUST** treat `catch (err)` as `unknown`; narrow with `instanceof` before reading fields.
- **SHOULD** return a discriminated result (`{ kind: 'bad_signature' }`) instead of throwing when the caller must branch on the outcome (adapters, router).
- In workflows, non-retryable failures **MUST** be `ApplicationFailure.nonRetryable(msg, 'TypeName')` with a stable type (e.g. `PodPendingTimeout`).

## 8. Async

- **MUST NOT** leave promises floating _(lint, planned: `no-floating-promises`)_. `await`, return, or explicitly `void` with a comment saying who handles errors. _Why: unhandled rejections crash Node 22._
- **MUST NOT** pass async functions where a sync callback is expected (`forEach`, event emitters) _(lint, planned: `no-misused-promises`)_.
- **SHOULD** use `Promise.all` for independent work and a `for…of` loop with `await` when order or back-pressure matters.
- **MUST** pass an `AbortSignal` (or Temporal cancellation scope) to long-running I/O (`streamLogs`, SSE, polling fetches) and stop on abort. _Why: leaked streams hold sockets and DB connections._
- **MUST NOT** use `Date.now()`/`new Date()` or `setTimeout` in code that needs tests to control time; inject `Clock` from `packages/core`. In Temporal workflows use only workflow APIs (`sleep`, `condition`), never Node timers or I/O.

## 9. Comments and docs

- **SHOULD** write comments for _why_, not _what_. _Why: the code already says what._
- **MUST** add a TSDoc line on every exported function, class and schema in `packages/*` whose name doesn't fully explain it (see `flattenRoutes`).
- **MUST** link the spec section when code implements a spec rule that isn't obvious: `// spec §6.2 step 6: non-cancellable scope`.
- `TODO` **MUST** have an owner or issue: `// TODO(#42): ...`. No bare `TODO`/`FIXME`.

## 10. Dead code

- **MUST NOT** commit commented-out code; git has history.
- **MUST** delete unused exports, files and dependencies in the change that orphans them. `noUnusedLocals` catches locals only; unused exports detection via `knip` (planned).
- **MUST NOT** keep feature flags or dev branches past their purpose. Dev-only surfaces (`/dev/*`, dev-login, `fake` provider) are the exception and are gated by config, see [security.md](security.md).

## Checklist

- [ ] No `any`, `!`, `@ts-ignore`, or shape-changing `as`.
- [ ] Every external value (HTTP, webhook, provider API, env, jsonb, `JSON.parse`) goes through a Zod schema.
- [ ] Request/response types come from `@agentdesk/contracts`, not redeclared.
- [ ] Unions have exhaustive `switch` with `assertNever`.
- [ ] No provider names in files, types, or functions outside `adapters/<provider>/`.
- [ ] Imports use package names and `import type`; no new cycles; no Nest in `core`/`db`.
- [ ] No empty `catch`; wrapped errors carry `cause`; domain errors are typed.
- [ ] No floating promises; long I/O is abortable; time comes from `Clock`.
- [ ] No commented-out code, bare TODOs, or orphaned exports.
