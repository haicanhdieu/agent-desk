# Reviewing test cases

You check one rule's cases (`rules/<BR-id>.json`) or, in the cross-rule pass, all rules together. You write a findings file (shape in [schemas.md](../schemas.md)). You do not edit the cases.

Read only: the requirement sources, `scope.json`, the `rules/*.json` drafts, `inventory.json`, and existing spec files under `apps/web/e2e/`. Do not open `apps/*/src`, `packages/*/src`, stories, mocks or implementation plans.

## Reviewing one rule

1. **Derive the conditions yourself first.** Read the rule and its requirements in `scope.json` and the source sections they cite. Using the technique table in [writing-cases.md](writing-cases.md), list the conditions the rule distinguishes before you open the draft.
2. **Compare with the draft's coverage table.** A condition on your list that no row covers is a `GAP`.
3. **Check every case** against the table below.
4. **Check coverage status.** For each `COVERED` or `PARTIAL` case, confirm it meets the bar in [checking-existing-coverage.md](checking-existing-coverage.md). For each `NEW` case, search `inventory.json` for an e2e title that already proves it.
5. Write `reviews/cases-<BR-id>-round-<n>.json`. An empty `findings` array means the cases are clean.

## Finding types

| Type             | Raise when                                                                                              | Example                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `GAP`            | A condition or boundary the source states has no coverage row or no case                                | The source says 1 to 40 characters; there is no case at 40      |
| `DUPLICATE`      | Two cases prove the same condition with the same steps                                                  | TC-BR03-02 and TC-BR03-05 both submit an empty name             |
| `VAGUE_EXPECTED` | An expected result cannot be asserted as written, or a step does not say what to do or with which value | "An error is shown" when the source gives the message text      |
| `NOT_FROM_SPEC`  | A step, value or expected result is not supported by the source                                         | Expects a toast the source never mentions                       |
| `NOT_ATOMIC`     | One case proves several unrelated conditions, or depends on another case having run                     | A case that checks both the limit and the empty state           |
| `WRONG_STATUS`   | `existing.status` is wrong in either direction                                                          | Marked `COVERED` by a test whose title only mentions the screen |
| `WRONG_PRIORITY` | The rule's core behaviour is not `smoke`, or an edge case is                                            | The main positive path is `full`                                |

## Cross-rule pass

You are given every `rules/*.json`. Look only for problems that span rules:

- `DUPLICATE`: the same condition and steps appear under two rules. Target both case ids joined with `+`, and propose which rule keeps the case.
- `GAP`: a behaviour in `scope.json`'s requirements that falls between two rules, so neither tests it.

Write `reviews/cases-cross.json`.

## Raise or let go

Raise a finding only if acting on it changes what a test would do or assert. Do not raise wording preferences or an alternative but equivalent set of cases.

For every finding, `detail` quotes the source or the case text that shows the problem, and `proposal` gives the exact change: the row and case to add, the case to delete, or the replacement text.
