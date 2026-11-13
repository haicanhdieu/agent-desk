# Reviewing the business rules

You check that `scope.json` misses nothing and invents nothing. You write `reviews/rules.json` (shape in [schemas.md](../schemas.md)). You do not edit `scope.json`. There is one review round, yours, so be thorough now: what you miss is never tested.

Read only the requirement sources and `scope.json`. Do not open `apps/*/src`, `packages/*/src`, stories, mocks or implementation plans.

## Procedure

1. **Blind pass first.** Before opening `scope.json`, read the sources named in your prompt and write your own list of rules to `reviews/rules-blind.md`, one line each in the form "When …, … ." with the section it came from. Use the category checklist in [extracting-rules.md](extracting-rules.md). Do this first so the draft cannot steer what you notice.
2. **Compare.** Open `scope.json`. For each rule on your list, find the draft rule that says the same thing. Each one with no match is a `MISSING` finding.
3. **Check the requirements list.** Scan the sources again for statements absent from `requirements[]`. Each is a `MISSING` finding targeting the section.
4. **Check each draft rule** against the table below.
5. **Check `excluded[]`.** A requirement excluded as "styling" or "implementation" that actually changes what a user can do or see is a `MISSING` finding.
6. **Check for duplicate and over-split rules.** Run `validate.mjs <workdir> rules` from the repo root and read its `!` warnings and `✗` errors about near-duplicates and over-splits; then look past them. Rules that share their requirements and category and differ only by which field, column or message type they name are one rule with one coverage row per field: raise `MERGE`. Examples: "the agent's messages stream live" and "the agent's tool calls stream live" are one rule, "streamed items appear live"; "the run list shows the status", "…the ticket", "…the start time" are one rule listing every column. Keep them apart only when the tests would need a different setup, actor or outcome, and say so in the finding (the orchestrator then records it in `distinctFrom`).
7. **Check `openQuestions[]`.** For each question, look in the sources for the answer. If the sources answer it, raise `ANSWERED_QUESTION` with the quote, and propose the change to the rule (or the new rule) the answer implies, plus deleting the question. If two questions ask the same thing in other words, raise `DUPLICATE_QUESTION` and name the one to keep.
8. Write the findings file. An empty `findings` array means the draft is clean.

## Finding types

| Type                 | Raise when                                                                                                     | Example                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MISSING`            | The source states a behaviour no rule tests, or a statement is absent from `requirements[]`                    | §4 says the list shows "No plugins yet" when empty; no rule covers the empty state                                                                                 |
| `SPLIT`              | One rule holds two outcomes or two conditions that can fail separately                                         | "…cannot continue and sees a hint"                                                                                                                                 |
| `MERGE`              | Two rules state the same condition and outcome, or one requirement was split per field, column or message type | BR-04 and BR-09 both say archived projects are read-only; BR-04 streams messages and BR-16 streams tool calls from the same "streams messages and tool calls live" |
| `NOT_A_RULE`         | The rule is styling, implementation detail, rationale, or cannot be observed by a user                         | "When saving, the client calls the projects endpoint"                                                                                                              |
| `UNTRACEABLE`        | The rule says more than its requirements do; the extra part was assumed                                        | The rule names a 5-second timeout the source never gives                                                                                                           |
| `AMBIGUOUS`          | The source can be read two ways and the rule picked one without an open question                               | "recent runs" with no number or period                                                                                                                             |
| `WRONG_CATEGORY`     | The category does not fit the rule                                                                             | A role restriction filed as `validation`                                                                                                                           |
| `DUPLICATE_QUESTION` | Two `openQuestions` ask the same thing in other words                                                          | Q2 "Is the plugin limit per project?" and Q5 "Does the 20-plugin cap apply per org or per project?"                                                                |
| `ANSWERED_QUESTION`  | The sources answer an open question                                                                            | Q4 asks whether archived projects can be edited; §6 says "archived projects are read-only"                                                                         |

## Raise or let go

Raise a finding only if acting on it would change which test cases get written. Do not raise wording preferences, a different but equally valid split, or a category that is defensible.

Every finding must be applicable without asking you anything: `detail` quotes the source words that show the problem, and `proposal` gives the exact change. For `MISSING`, give the requirement text with its source and the full rule (title, statement, category). For `SPLIT`, give both statements. For `MERGE`, name the id to keep and give the merged statement. For `AMBIGUOUS`, give the open question. For `DUPLICATE_QUESTION`, target both ids joined with `+` and give the one question to keep (merged wording if needed). For `ANSWERED_QUESTION`, quote the answer and give the rule change it implies.
