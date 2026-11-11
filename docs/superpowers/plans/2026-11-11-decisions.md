# Decisions log — design system & Storybook (2026-11-11)

No decision was escalated to an Opus agent; none needed the user's input. All judgment calls were made by the controller as rulings (cost-if-wrong in each).

1. `runDetail` fixtures are `web/src/mocks/runDetail.tsx` (JSX in `endNote.body`). Cost: rename.
2. mocks↔components imports use `import type`. Cost: none.
3. Foundations stories split into Colors / Typography / RadiusSpacing files. Cost: file merge.
4. Idle pill glyph matches prototype exactly ("Needs you" text is the non-colour cue). Cost: add a distinct cue.
5. Find button label was kept as "Search scrollback" (Task 9), then renamed "Find in scrollback" after final review (WCAG 2.5.3 label-in-name). Cost: one-line revert.
6. RunReconnect `startedAt` reuses 14:05:12; code-review/code-e2e/qa-e2e skill bodies are stubs. Cost: update fixtures.
7. Screen stories size the artboard with a fixed wrapper; Task 19 added viewport presets. Cost: rework decorators.
8. Task 16 empty-state copy is invented (boards have none). Cost: replace copy.
9. Task 20 parity review covered all 24 board pairs in-task. Cost: one extra fix round (spent).
10. 1–10px drifts (NeedsYou, Setup1, side-panel rows, DeskRules stats wrap) left unfixed and documented in `design/parity-notes.md`; some screenshots not re-inspected after the last fixes. Cost: follow-up visual pass.
11. Remaining minors from the final review stay deferred (nested-overlay Escape, hardcoded hrefs, tone vocabulary, `cx` duplication, raw px sizes, etc.). Cost: follow-up polish.

## Awaiting you
- Merge/push of `feat/design-system-storybook` (nothing pushed or merged).
- Before wiring real data: decide the route scheme (hardcoded `/runs`, `/desk`, `/projects` hrefs), and the tone vocabulary across Banner/InlineStatus/Meter.
