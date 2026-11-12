# Agent Desk web

React 19 + TypeScript + Vite SPA: TanStack Router (file routes) and Query, TanStack Form, CSS Modules, xterm for the
run terminal, MSW for mock mode, Storybook (react-vite), Vitest and Playwright.

| Script                 | Purpose                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`             | Vite dev server; proxies `/api` (with the terminal WebSocket), `/auth`, `/webhooks`, `/dev` to the API on :3000 |
| `pnpm dev:mock`        | Vite in `mock` mode: the API is served from MSW in the browser, no backend                                      |
| `pnpm storybook`       | Storybook on :6006                                                                                              |
| `pnpm build-storybook` | Static Storybook build (`storybook-static/`, not committed)                                                     |
| `pnpm test`            | Vitest (includes the stories smoke test with axe)                                                               |
| `pnpm test:e2e:mock`   | Mock-mode build, then the Playwright suite in `e2e/mock`                                                        |
| `pnpm typecheck`       | `tsc --noEmit`                                                                                                  |
| `pnpm lint`            | ESLint                                                                                                          |
| `pnpm parity`          | Screenshots each screen story next to its prototype board (`parity-out/`, after `build-storybook`)              |

Path alias `@/` maps to `src/`. Dark theme only.

## Layout

- `src/app/`: router, query client, providers, error boundaries; `routes/` holds the file routes (`/o/$org/...`,
  `routeTree.gen.ts` is generated and committed). Route components are the only containers.
- `src/features/<area>/`: query factories, mutations, DTO → view-model mappers and hooks (auth, projects, setup,
  desk, runs: SSE events, the terminal socket). No markup beyond what a hook needs.
- `src/ds/`, `src/components/`, `src/screens/`: design system, composites and screens. They import only from `@/ds`,
  `@/components`, `@/mocks` (never the router, Query or contracts) and render in Storybook from fixtures.
- `src/mocks/`: board fixtures; `mocks/dto` (contract DTO fixtures) and `mocks/msw` (handlers over an in-memory
  store, shared by Vitest, Storybook and `dev:mock`).
- `src/test/`: Vitest setup and test doubles (EventSource, WebSocket, xterm).

## Mock mode (`pnpm dev:mock`)

- Signed in as alice; sign-in and sign-out state survive reloads (sessionStorage), the rest of the store resets on
  every page load.
- Opening queued run 63 plays a short script (starting → running → needs you) over the event streams.
- The run terminal socket gets a fake echo terminal (`mocks/msw/fakeTerminal.ts`); it is loaded in mock mode only.
- `mocks/msw/scenarios.ts` (signed out, server errors, problems, run scripts) drives tests and stories.

## Contract gaps

Data the screens need that `packages/contracts` lacks is listed in [CONTRACT-GAPS.md](CONTRACT-GAPS.md), with how the
app derives or guards it until the contracts catch up.

## Stories

Stories sit next to components (`src/ds`, `src/components`), one file per screen group in
`src/screens/<group>.stories.tsx`. Titles are `Foundations/*`, `Primitives/*`, `Components/*`, `Screens/<Group>`;
screen story export names equal the prototype board base name. The prototype snapshot lives in
`../../design/prototype`.
