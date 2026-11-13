# Reviewing the business rules

You check that `scope.json` misses nothing and invents nothing. You write `reviews/rules-round-<n>.json` (shape in [schemas.md](../schemas.md)). You do not edit `scope.json`.

Read only the requirement sources and `scope.json`. Do not open `apps/*/src`, `packages/*/src`, stories, mocks or implementation plans.

## Procedure

1. **Blind pass first.** Before opening `scope.json`, read the sources named in your prompt and write your own list of rules to `reviews/rules-blind-round-<n>.md`, one line each in the form "When …, … ." with the section it came from. Use the category checklist in [extracting-rules.md](extracting-rules.md). Do this first so the draft cannot steer what you notice.
2. **Compare.** Open `scope.json`. For each rule on your list, find the draft rule that says the same thing. Each one with no match is a `MISSING` finding.
3. **Check the requirements list.** Scan the sources again for statements absent from `requirements[]`. Each is a `MISSING` finding targeting the section.
4. **Check each draft rule** against the table below.
5. **Check `excluded[]`.** A requirement excluded as "styling" or "implementation" that actually changes what a user can do or see is a `MISSING` finding.
6. Write the findings file. An empty `findings` array means the draft is clean.

## Finding types

| Type             | Raise when                                                                                  | Example                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `MISSING`        | The source states a behaviour no rule tests, or a statement is absent from `requirements[]` | §4 says the list shows "No plugins yet" when empty; no rule covers the empty state |
| `SPLIT`          | One rule holds two outcomes or two conditions that can fail separately                      | "…cannot continue and sees a hint"                                                 |
| `MERGE`          | Two rules state the same condition and outcome                                              | BR-04 and BR-09 both say archived projects are read-only                           |
| `NOT_A_RULE`     | The rule is styling, implementation detail, rationale, or cannot be observed by a user      | "When saving, the client calls the projects endpoint"                              |
| `UNTRACEABLE`    | The rule says more than its requirements do; the extra part was assumed                     | The rule names a 5-second timeout the source never gives                           |
| `AMBIGUOUS`      | The source can be read two ways and the rule picked one without an open question            | "recent runs" with no number or period                                             |
| `WRONG_CATEGORY` | The category does not fit the rule                                                          | A role restriction filed as `validation`                                           |

## Raise or let go

Raise a finding only if acting on it would change which test cases get written. Do not raise wording preferences, a different but equally valid split, or a category that is defensible.

For every finding, `detail` quotes the source words that show the problem and `proposal` gives the exact change: the new statement, the two statements to split into, the ids to merge, or the open question to add. A finding without a concrete proposal is not finished.

On round 2 or later, you are also given the earlier findings with their resolutions. Do not raise a rejected finding again unless the stated reason is wrong against the source; if so, say why in `detail`.
