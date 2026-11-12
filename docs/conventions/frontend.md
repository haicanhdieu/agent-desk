# Frontend guidelines

How we build `apps/web`: a Vite SPA on TanStack Router + TanStack Query, rendering a design system that matches the prototype pixel for pixel.
These rules keep presentational code renderable in Storybook, keep data typed end to end by `@agentdesk/contracts`, and keep the UI accessible.

**Applies to:** `apps/web/**`, `packages/contracts/src/client/**`. Source of truth: `docs/superpowers/specs/2026-11-12-frontend-design.md`, `docs/superpowers/plans/2026-11-12-frontend-local.md`, `design/parity-notes.md`.
Related: [architecture.md](architecture.md), [typescript.md](typescript.md), [testing.md](testing.md), [security.md](security.md), [backend.md](backend.md), [code-review-checklist.md](code-review-checklist.md).

> Status: `ds/`, `components/`, `screens/`, `mocks/`, Storybook and Vitest exist today. `app/`, `features/`, TanStack Router/Query/Form, Zod in web, MSW, React 19 and the contracts `api` client are being added by the frontend plan. Rules about them apply from the first commit that adds them; tooling that would enforce them is marked (planned).

## 1. Layers and folders

```
apps/web/src
  ds/          primitives + tokens.css, global.css, tokens.ts       (presentational)
  components/  composites built from ds                             (presentational)
  screens/     whole screens, props + callbacks only                (presentational)
  mocks/       view fixtures; mocks/dto (DTO fixtures), mocks/msw (handlers, scenarios)
  app/         router, providers, routes/, boundaries, RouterLink, useNow
  features/<area>/  queries.ts, mutations.ts, map.ts, hooks.ts, *.form.ts
  test/        setup.ts, cross-cutting tests, renderRoute, fakes
```

- **MUST NOT** import the router, TanStack Query/Form, or `@agentdesk/contracts` from `ds/`, `components/` or `screens/`. Why: they must render in Storybook from fixtures alone. Enforced by an ESLint `no-restricted-imports` boundary rule (planned); today by review.
- **MUST** make the route component the only container: it reads data via `features/*`, maps it, and renders exactly one screen with props and callbacks. Why: one place per page owns data; screens stay dumb.
- **MUST NOT** render markup from `features/*` beyond what a hook needs. Why: features are data, not UI.
- **MUST** import across folders through the barrel and `@/` alias (`@/ds`, `@/components`, `@/mocks`); add every new export to that folder's `index.ts`. Why: stable public surface per layer.
- Screens import only from `@/ds`, `@/components`, `@/mocks`.

```tsx
// Bad: screens/Runs.tsx
import { useQuery } from '@tanstack/react-query';
// Good: app/routes/o.$org.p.$project.runs.index.tsx
const runs = useSuspenseQuery(runsQueries.list(org, projectId, filter));
return <Runs groups={runs.data} onFilter={setFilter} />;
```

## 2. Routes (TanStack Router, file-based)

- **MUST** put route files in `src/app/routes/` using flat dot naming that mirrors the URL: `o.$org.p.$project.runs.$run.tsx`, layouts as `o.$org.tsx`, `o.$org.p.$project.tsx`, index routes as `*.index.tsx`. Why: the Vite plugin generates `routeTree.gen.ts` from names; flat names make URLs greppable.
- **MUST NOT** edit `src/app/routeTree.gen.ts` by hand. Why: it is regenerated.
- **MUST** keep every org-scoped URL under `/o/$org/...` (`$org` = slug, `$project` = id, `$run` = per-project run number). Why: deep links survive multi-tenancy.
- **MUST** declare search params with a Zod `validateSearch` schema that falls back to defaults on bad input (`?filter=bogus` → `all`). Why: URLs are user input.
- **MUST** accept only relative paths for `redirect` search params. Why: open-redirect prevention (see [security.md](security.md)).
- **MUST** navigate via the `LinkProvider` link (`RouterLink` from `createLink`) inside screens; use plain `<a>` only for external links (GitHub). Why: client-side nav and intent preload without screens importing the router.
- **SHOULD** use `beforeLoad` for guards (session, org membership) and `loader` with `queryClient.ensureQueryData` for data.

## 3. Data fetching

- **MUST** fetch only through `features/<area>/queries.ts` (`queryOptions` factories) and `mutations.ts`, which call the typed `api` client from `@agentdesk/contracts/client`. **MUST NOT** call `fetch` directly in web code (exceptions: `EventSource` / `WebSocket` URLs built with `sseRunPath`, `sseProjectPath`, `terminalPath`). Why: one typed path, one error type (`ApiError`), one 401 handler.
- **MUST** use contracts types (`RunDto`, `CreateRuleRequest`, ...) for request and response shapes; never redeclare a DTO in web. Why: Zod in contracts is the single source for Nest and web.
- **MUST** start every query key with `['org', orgSlug]` (only exception: `['session']`), built by the area's key factory. Why: switching org clears exactly the org cache.
- **MUST** convert DTOs to screen types with pure mappers in `features/<area>/map.ts`, applied via Query `select`, with a unit test. Why: screens keep display-ready types (`'5 min'`, `'12m 04s'`); mapping is testable.
- **MUST** pass `now: Date` into mappers and render relative times through the shared `useNow()` (30 s tick). Why: cached data doesn't go stale visually; tests stay deterministic.
- **MUST** use the global Query defaults (staleTime 30 s, retry twice only for status 0 / 5xx, refetch on focus only for runs + connection); override per query only with a comment saying why.
- **MUST** patch the cache from SSE with `setQueryData` / `setQueriesData`, deduping by `seq`. **MUST NOT** refetch on every event. Why: realtime without request storms.
- Mutations: optimistic only where the spec says (rule toggle, cancel/finish note) with rollback + error toast; everything else invalidates affected keys on success.
- **MUST NOT** cache secrets: credential replace is write-only, its response is not stored, it only invalidates `desk.agent`. Why: FR-3, see [security.md](security.md).

```ts
// Bad
const res = await fetch(`/api/projects/${id}/runs`);
const data = await res.json();
// Good
export const runsQueries = {
  list: (org: string, projectId: string, filter: RunListFilter) =>
    queryOptions({
      queryKey: ['org', org, 'projects', projectId, 'runs', 'list', filter],
      queryFn: () => api.runs.list({ params: { projectId }, query: { filter } }),
    }),
};
```

## 4. State management

- **MUST** keep state in, in order of preference: the URL (typed search params), the Query cache (server state), local component state. Why: no global store is needed; refresh and deep links just work.
- **MUST NOT** add Zustand/Redux/Jotai or a React context for server data without a written concrete need in the PR. Why: decided in the frontend spec (Client-only state: none).
- **MUST NOT** persist wizard or form progress in memory or storage; the setup flow resumes from server state (`project.setupStep`). Why: one source of truth.
- **SHOULD** keep `useState` local to the component that owns it; lift only to the nearest common parent.

## 5. Styling and design tokens

- **MUST** use CSS Modules per component (`Button.module.css`); class names mirror the prototype (`.btn`, `.st-pill`). Why: each rule traces back to a prototype rule. `src/test/cssModules.test.ts` fails on a referenced class that does not exist.
- **MUST NOT** write a raw color (hex, `rgb()`, named) outside `src/ds/tokens.css`; use `var(--token)`. Why: the palette lives in one file, pinned by `tokens.test.ts`. Lint check for raw colors (planned: stylelint `color-no-hex` with an allowlist for `tokens.css`).
- **MUST** use `--fs-*` for font sizes and `--radius-*` for radii. Why: the prototype's type and radius scales are tokenised.
- Spacing has no token scale yet: pixel values for padding/gap/margin **MUST** be copied from the prototype, not invented. A spacing scale is (planned); don't introduce ad hoc `--space-*` variables in a module.
- **MUST** add a new token to `tokens.css` (and the `Foundations/Colors` story) before using a new color. Why: the foundations stories are the palette's documentation.
- **MUST NOT** use inline `style` for colors or typography; inline style is acceptable for computed geometry (widths, percentages).
- **MUST** use `StatusTone` (`ok | warn | err | late | idle | off`) for status-bearing props; amber (`--idle`) is reserved for "needs you". Dark theme only.

```css
/* Bad */
.row {
  color: #a3abb8;
  font-size: 13px;
  border-radius: 6px;
}
/* Good */
.row {
  color: var(--muted);
  font-size: var(--fs-13);
  border-radius: var(--radius-6);
}
```

## 6. Components and naming

- **MUST** name component files and exports in PascalCase, one main component per file: `RunRow.tsx`, `RunRow.module.css`, `RunRow.stories.tsx`, `RunRow.test.tsx` side by side. Hooks are `useX.ts`; pure helpers camelCase (`highlightMarkdown.ts`).
- **MUST** put a component in `ds/` if it is a primitive with no domain knowledge, in `components/` if it composes primitives for a domain concept, in `screens/` if it is a full board.
- **MUST** type props with an exported `interface <Name>Props`; required accessibility props are required in the type (`IconButton` without `aria-label` is a type error). Why: a11y enforced by the compiler.
- **MUST** keep presentational components controlled (`value` / `onChange`) and callback-driven (`onCancel`, `onCommit`); no network, no global state, no router.
- **SHOULD** add a callback prop rather than an `href` when a screen action becomes a mutation.

## 7. Storybook

- **MUST** give every exported component in `ds/` and `components/` a story next to it. Why: Storybook is the catalog and the smoke/axe test input. A coverage check for `ds/` + `components/` exports is (planned); `src/test/coverage.test.ts` already enforces it for screens.
- Titles: `Foundations/<Topic>`, `Primitives/<Name>` (ds), `Components/<Name>` (components), `Screens/<Group>` (one file per group `screens/<group>.stories.tsx`). Screen story export names equal the prototype board name (`RunIdle`, `DeskSkills`) and set `parameters.layout: 'fullscreen'` plus the board viewport.
- **MUST** cover each meaningful state in stories: default, loading (`Skeleton`), empty, error, disabled, long text (ellipsis), and each `StatusTone` / run status the component accepts.
- **MUST** feed stories from `@/mocks` fixtures, never from live data.
- Every story is rendered and axe-checked by `src/test/stories.smoke.test.tsx` on `pnpm test`; a story that throws or has an axe violation fails the build.

## 8. Visual parity

1. Change a `ds`, `components` or `screens` file that affects a board.
2. Build Storybook and run the parity script; steps are in the runbook [storybook-and-parity.md](../runbooks/storybook-and-parity.md).
3. Compare `apps/web/parity-out/<Board>.story.png` against `<Board>.proto.png` for every board you touched.

- **MUST** leave no drift beyond what `design/parity-notes.md` lists; fix it or record it there with a reason (intentional state difference, needs browser check, not fixed).
- **MUST** add a new prototype board to `canvas.json`, `screens/storyIds.ts` and `scripts/parity.mjs` together. Why: `coverage.test.ts` requires the lists to match.
- **MUST NOT** rewrite UI copy taken from the prototype in the same PR as a code change. Copy changes go through the copy pass.
- Automated pixel-diff threshold in CI is (planned); today parity is a reviewed screenshot pass.

## 9. Loading, empty and error states

Every route and data-backed component **MUST** handle all four states; the mapping is fixed by the spec:

| State                    | UI                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Loading                  | Router `pendingComponent` (`pendingMs`/`pendingMinMs` 300) with `Skeleton` built from the page layout; no spinners over blank pages |
| Empty                    | The screen's existing empty state (`EmptyState`, `ProjectsEmpty`, zero runs/skills/rules copy), never a blank panel                 |
| 404 / 403                | Route not-found / "You don't have access" `EmptyState`                                                                              |
| 5xx / network (status 0) | `Banner` tone `err` with `title`, `detail`, Retry (`router.invalidate()`)                                                           |
| Form error               | Field errors from problem+json `errors[]`, else a form `Banner`                                                                     |
| Inline mutation error    | Roll back, `Toast` with the problem `title`                                                                                         |
| Crash                    | Root `errorComponent` with Reload and `requestId`                                                                                   |

- **MUST** surface `requestId` on unexpected errors. Why: support can find the server log line.
- **MUST** show `reconnecting` on the `ConnectionIndicator` while SSE reconnects; keep cached data visible.

## 10. Accessibility

- **MUST** use real `<button>`, `<a href>`, `<input>` with a `<label>`; no clickable `div`s.
- **MUST** keep the global `:focus-visible` outline (`2px solid var(--accent)`); never `outline: none` without a replacement.
- **MUST NOT** convey status by color alone: glyph plus text label, or an accessible name (`StatusIcon title`).
- **MUST** give icon-only buttons an `aria-label`; decorative icons stay `aria-hidden`.
- **MUST** move focus into dialogs/popovers on open, close on `Escape`, return focus to the opener (`useFocusTrap`).
- **MUST** keep heading order (use `h2.h3` for a visual size change, not a skipped level) and use `.sr-only` for visually hidden labels.
- **MUST** link field errors with `aria-invalid` + `aria-describedby` (via `Field error`).
- Toasts use `role="status"`, errors `role="alert"`. `Skeleton` is `aria-hidden` and respects `prefers-reduced-motion`.
- Axe runs in jsdom for every story with `color-contrast` disabled; contrast is checked against the built Storybook. Contrast exceptions live in `design/parity-notes.md`.

## 11. Forms and validation

- **MUST** build forms with TanStack Form validated by the contracts **request** schema (`CreateRuleRequest`, `PutAgentRequest`). **MUST NOT** hand-write a parallel validation schema. Why: client and server reject the same inputs.
- **MUST** submit with `mutateAsync` and map `ApiError.errors[].pointer` to fields with `fieldErrorsFromProblem`; unmapped errors go to the form `Banner`.
- **MUST** keep the user's input on a failed submit and show pending state on the submit button.
- **MUST** render secrets in `type="password"` inputs that start empty; a saved credential shows only type, who set it and when.

## 12. Performance

- **MUST** lazy-load heavy, route-specific code (`LiveTerminal` / xterm via `React.lazy`). Why: xterm downloads only on run detail.
- **SHOULD** rely on `defaultPreload: 'intent'` and loaders instead of fetch-on-render waterfalls; use `useSuspenseQueries` for parallel reads.
- **MUST** debounce resize-driven work (terminal fit: 100 ms) and close streams when idle (project SSE after 60 s hidden).
- **SHOULD NOT** memoise by default; add `useMemo`/`memo` when a profile or a long list (runs table) shows a cost.
- **MUST** keep `select` mappers pure and cheap; they run on every cache update.

## Checklist

- [ ] No router/Query/Form/contracts import in `ds/`, `components/`, `screens/`; route component is the only container.
- [ ] Route file name matches the URL; search params validated with Zod; redirects relative only.
- [ ] Data goes through `features/*` queries/mutations and the contracts `api`; keys start with `['org', org]`; DTOs mapped in tested `map.ts`.
- [ ] No new global store; state lives in URL, Query or the component.
- [ ] No raw colors; `--fs-*`/`--radius-*` used; spacing copied from the prototype.
- [ ] Every new/changed `ds`/`components` export has stories covering its states; smoke + axe test passes.
- [ ] Parity run for touched boards; drift fixed or recorded in `design/parity-notes.md`.
- [ ] Loading, empty, error (404/403/5xx/form/inline) states handled.
- [ ] Keyboard, focus, labels, non-color status checked.
- [ ] Forms validate with the contracts request schema; problem pointers map to fields; secrets never cached.
- [ ] Heavy code lazy-loaded; no fetch waterfalls.
