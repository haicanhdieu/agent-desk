# Area: UI/UX

What a person sees and does in `apps/web`. You own the spec's `## UI and Storybook` section.

Read first: `docs/conventions/frontend.md`, `docs/runbooks/storybook-and-parity.md`, and the boards in `design/prototype/project/` (`*.dc.html`, `canvas.json`) closest to the screens this touches.

**Not applicable:** when nothing a person sees in `apps/web` changes (no screen, component, state, control or copy), say so with the reason in your first reply (`STATUS: not-applicable`). You are not resumed after that.

## Deep-dive items

Work through every item. An item the change does not touch gets one line in your findings saying so; never drop it.

1. **Screens and routes.** Each screen and route (TanStack Router) added or changed, and how a user gets there.
2. **User flows.** Each flow step by step: the happy path, then each alternate and failure path from the business rules.
3. **Components.** Reuse from `apps/web/src/ds` and `components` first; each new or changed shared component, and the story it needs (rule 10).
4. **States.** For each screen and component: default, loading, empty, error (all three required where data loads, rule 10), plus disabled, partial, stale or reconnecting, and permission-denied where they apply.
5. **Copy.** Labels, buttons, messages, empty and error text, in the wording style of the existing boards. Text the requirement does not give is a question only when it changes meaning; otherwise follow the existing style and record it as an `Agent call:`.
6. **Visual system.** Design tokens only; no new color, font or spacing scale. The existing board each screen is closest to.
7. **Data on screen.** TanStack Query reads and writes, cache invalidation, optimistic updates, live stream updates, what shows while a write is in flight.
8. **Forms and input.** Validation from the contracts' Zod schemas, where and when errors show, what is kept on failure.
9. **Role-based UI.** Which controls each role sees, sees disabled, or does not see.
10. **Accessibility.** Keyboard path, focus order and return, labels and ARIA, contrast.
11. **Layout.** Behaviour at narrow and wide viewports; what scrolls inside the viewport and what stays fixed.
12. **Storybook and prototype.** Each story to add or update (by `ds/`, `components/`, `screens/`) with its `@/mocks` fixtures, and the prototype boards a Prototyper would draw (gate P1 asks the human whether to draw them).

## Design fields (in your `STATUS: design` reply)

```text
UI: <yes | no>
SCREENS: <one line per screen or route: new or changed, entry point>
FLOWS: <one line per flow: steps in short>
STATES: <one line per screen or component: the states it gains or changes>
COMPONENTS: <one line per component: reused, new or changed, story needed>
COPY: <one line per label or message decided; or "none">
```
