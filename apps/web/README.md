# Agent Desk web

React 18 + TypeScript + Vite, CSS Modules, Storybook (react-vite), Vitest.

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm storybook` | Storybook on :6006 |
| `pnpm build-storybook` | Static Storybook build |
| `pnpm test` | Vitest (includes the stories smoke test) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |

Path alias `@/` maps to `src/`. Dark theme only.

Story conventions: stories sit next to components (`src/ds`, `src/components`),
one file per screen group in `src/screens/<group>.stories.tsx`. Titles are
`Foundations/*`, `Primitives/*`, `Components/*`, `Screens/<Group>`; screen story
export names equal the prototype board base name. Screens import only from
`@/ds`, `@/components`, `@/mocks`. Prototype snapshot lives in `../../design/prototype`.
