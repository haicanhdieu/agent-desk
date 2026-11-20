# Area: Testing

How each behaviour will be proved, at which layer, with what fakes. You own the spec's `## Testing` section. You decide which business rule (`BR-<n>`, from the business area) is proved where; the detailed e2e cases (given, steps, expected) are a later, optional phase (gate B) that writes cases only for the rules you send to e2e.

Read first: `docs/conventions/testing.md`, `docs/runbooks/tests-and-e2e.md`, and the existing tests next to the code the change touches.

## Deep-dive items

Work through every item. An item the change does not touch gets one line in your findings saying so; never drop it.

1. **Behaviours to prove.** Every `BR-<n>` in the business area's findings, plus each behaviour no user sees (from its `Not observable` list and the architecture area) that still needs a test. Read `areas/business.md` each round: rules are added and changed between rounds.
2. **Layer per behaviour.** The lowest layer that proves it: unit (core and domain logic), integration (db with RLS, api with auth), contract (Zod schemas, route table), component and story (web), e2e mock Playwright (the web app alone) or e2e local Playwright (crosses API, worker, runner or the fake pod) as in `tests-and-e2e.md` §3a.
3. **E2E per rule.** Every `BR-<n>` and every other cross-component behaviour has an e2e spec (AGENTS.md › Workflow), with its env: `mock` when the web app alone proves it, `local` when it crosses the API, worker, runner or fake pod. A rule e2e cannot prove (a multi-hour timer) gets the reason and the lowest layer that does. No `BR-<n>` is left without one of the two.
4. **Bug fixes.** Each bug fix starts with a failing test (rule 9): name the test that fails today.
5. **No network.** Fakes and doubles for every outside call (provider APIs, Kubernetes, the runner): which exist, which must be added (rule 9).
6. **Fixtures and mocks.** Test data, `@/mocks` fixtures shared by stories and mock e2e, seed data for local e2e.
7. **Security tests.** Cross-org and cross-project access denied (rule 4), authz per endpoint and on terminal attach (rule 7), webhook signature rejected when wrong, secrets redacted in output (rule 5), untrusted text never executed (rule 6).
8. **Worker and time.** Temporal workflow tests with time skipping, retries, cancellation, idempotency.
9. **Migrations.** The migration applies on existing data and the RLS policy holds.
10. **Coverage gate.** Per-package floors, the baseline, 80% on changed lines, and the sensitive-path group floors (`testing.md` §10): where this change risks a drop and how the tests above cover it. Never plan to lower a threshold.
11. **Determinism.** Flakiness risks (streams, timers, ordering, real clocks) and how each test avoids them.

## Design fields (in your `STATUS: design` reply)

```text
LAYERS: <one line per behaviour: layer, and the package or folder the test lives in>
E2E: <one line per BR-<n> (or other cross-component behaviour): mock | local, the flow it drives>
NOT E2E: <one line per BR-<n> or behaviour e2e cannot prove: reason, and the layer that proves it; or "none">
FAKES: <one line per fake or fixture: existing or new; or "none">
SECURITY TESTS: <one line each; or "none">
COVERAGE RISKS: <one line each; or "none">
```
