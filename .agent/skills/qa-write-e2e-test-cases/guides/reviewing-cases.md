# Reviewing the test cases of a cluster

You check the `rules/<BR-id>.json` files of one cluster. You write `reviews/cases-<CL-id>.json` (shape in [schemas.md](../schemas.md)). You do not edit the cases. There is one review round, yours, and the orchestrator applies your proposals as written without a second writer.

Read only: the requirement sources, `scope.json`, the drafts of your cluster, the two `inventory-*.txt` files, and existing spec files under `apps/web/e2e/`. Do not open `apps/*/src`, `packages/*/src`, stories, mocks or implementation plans.

## Procedure

1. **Derive the conditions yourself first.** For each rule in the cluster, read it and its requirements in `scope.json` and the source sections they cite. Using the technique table in [writing-cases.md](writing-cases.md), list the conditions the rule distinguishes before you open its draft.
2. **Compare with each draft's coverage table.** A condition on your list that no row covers is a `GAP`.
3. **Check every case** against the table below.
4. **Look across the cluster's rules** for the same condition and steps written under two rules (`DUPLICATE`).
5. **Check coverage status.** For each `COVERED` or `PARTIAL` case, confirm it meets the bar in [checking-existing-coverage.md](checking-existing-coverage.md). For each `NEW` case, look in `inventory-e2e.txt` for a title that already proves it.
6. **Check the open questions.** `scope.json` `openQuestions` is the registry. For each `{ "question": … }` item in your cluster's rule files: if it asks what a registry question or another rule's question asks, in any wording, raise `DUPLICATE_QUESTION`; if the sources answer it, raise `ANSWERED_QUESTION`. Run `validate.mjs <workdir> cluster <CL-id>` and include every question it flags, but do not stop there: the validator only catches similar wording. Also raise `DUPLICATE_QUESTION` for a case `note` that only restates an open question.
7. Write the findings file. An empty `findings` array means the cases are clean.

## Finding types

| Type                 | Raise when                                                                                                    | Example                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GAP`                | A condition or boundary the source states has no coverage row or no case                                      | The source says 1 to 40 characters; there is no case at 40                                                          |
| `DUPLICATE`          | Two cases prove the same condition with the same steps, under one rule or two                                 | TC-BR03-02 and TC-BR05-01 both submit an empty name                                                                 |
| `VAGUE_EXPECTED`     | An expected result cannot be asserted as written, or a step does not say what to do or with which value       | "An error is shown" when the source gives the message text                                                          |
| `NOT_FROM_SPEC`      | A step, value or expected result is not supported by the source                                               | Expects a toast the source never mentions                                                                           |
| `NOT_ATOMIC`         | One case proves several unrelated conditions, or depends on another case having run                           | A case that checks both the limit and the empty state                                                               |
| `WRONG_STATUS`       | `existing.status` is wrong in either direction                                                                | Marked `COVERED` by a test whose title only mentions the screen                                                     |
| `WRONG_PRIORITY`     | The rule's core behaviour is not `smoke`, or an edge case is                                                  | The main positive path is `full`                                                                                    |
| `DUPLICATE_QUESTION` | A rule's question restates a registry question or another rule's question, or a case note restates a question | BR-07 asks "Is the cap per org?", which Q1 already asks; TC-BR07-02's note says "the cap scope is an open question" |
| `ANSWERED_QUESTION`  | The sources answer a rule's open question                                                                     | BR-03 asks for the error text; §4.2 gives "Name is required"                                                        |

## Raise or let go

Raise a finding only if acting on it changes what a test would do or assert. Do not raise wording preferences or an alternative but equivalent set of cases.

Every finding must be applicable as written:

- `target` is the case or row id (`TC-BR03-02`, `BR-03/C4`), the rule id for a missing row, or two case ids joined with `+` for a `DUPLICATE`.
- `detail` quotes the source or the case text that shows the problem.
- `proposal` gives the exact change. For a `GAP`, the coverage row and the full case to add: id, title, priority, type, preconditions, data, steps, expected, covers. For a `DUPLICATE`, which case to delete. For a wording problem, the replacement text.
- For a `DUPLICATE_QUESTION`, `target` is `BR-xx/openQuestions[n]` (or the `TC` id for a note), plus `+Qn` or `+BR-yy/openQuestions[m]` for what it repeats. The `proposal` is the replacement item, `{ "ref": "Qn" }` or `{ "ref": "Qn", "detail": "…" }` for what only this rule needs, or, when two rules repeat each other and no registry question exists, the new `scope.json` question (`about` listing both rules) and the `ref` for each rule. For a note, the replacement note (`Depends on Qn.`) or its removal.
- For an `ANSWERED_QUESTION`, `detail` quotes the answer, and `proposal` deletes the question and gives any coverage row or case the answer now makes testable.
