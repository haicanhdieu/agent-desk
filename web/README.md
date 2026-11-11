# Agent Desk web

React 18 + TypeScript + Vite, CSS Modules, Storybook (react-vite), Vitest.

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run storybook` | Storybook on :6006 |
| `npm run build-storybook` | Static Storybook build |
| `npm test` | Vitest (includes the stories smoke test) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

Path alias `@/` maps to `src/`. Dark theme only.

Story conventions: stories sit next to components (`src/ds`, `src/components`),
one file per screen group in `src/screens/<group>.stories.tsx`. Titles are
`Foundations/*`, `Primitives/*`, `Components/*`, `Screens/<Group>`; screen story
export names equal the prototype board base name. Screens import only from
`@/ds`, `@/components`, `@/mocks`. Prototype snapshot lives in `../design/prototype`.
