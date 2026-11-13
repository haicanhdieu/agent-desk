# Subagent prompts

Spawn each with the Agent tool. Fill the `<…>` slots and send the prompt as written. Paths are absolute so the subagent needs no other context. `<skill>` is this skill's directory.

Every prompt carries the reading rule, because a subagent does not inherit it from you.

## Model and effort

Pass both on every spawn; this skill asks for them explicitly. Do not let a subagent inherit the session model.

| Agent         | Spawns        | `model`  | `effort` | Why                                                                                  |
| ------------- | ------------- | -------- | -------- | ------------------------------------------------------------------------------------ |
| Rule reviewer | 1             | `opus`   | `high`   | A rule it misses is never tested, and it runs once                                   |
| Case writer   | 1 per cluster | `sonnet` | `medium` | Follows a guide with a worked example; the validator and a reviewer check its output |
| Case reviewer | 1 per cluster | `sonnet` | `medium` | Compares cases to a short source excerpt with a fixed finding list                   |

Do not use `haiku` for any of them: weak cases cost more to reconcile than they save. Extraction, clustering and reconciling are yours, on the session model.

In another harness, use its closest equivalent. If it cannot choose a model per subagent, spawn with its default.

## Rule reviewer (step 3)

Model `opus`, effort `high`.

```text
You are reviewing a list of business rules extracted from requirement documents, to make sure
nothing is missed and nothing is invented. Test cases will be written from this list, so a rule
missing here is behaviour that never gets tested. You get one pass; there is no second round.

Follow <skill>/guides/reviewing-rules.md exactly. Output shape: <skill>/schemas.md ("reviews").

Sources to read: <source paths, with sections>
Draft to review (open only after your blind pass): <workdir>/scope.json

Write your blind list to <workdir>/reviews/rules-blind.md
Write your findings to <workdir>/reviews/rules.json

Reading rule: read only the sources above and files in <workdir> (not inventory.json). Do not
open apps/*/src, packages/*/src, stories, mocks or implementation plans; the implementation may
be wrong.

Reply with one line: the number of findings by type.
```

## Case writer (step 5, one per cluster)

Model `sonnet`, effort `medium`.

```text
You are writing end-to-end test cases for one cluster of business rules. An engineer or agent
will later automate them from a GitHub issue without asking you anything, so each case must be
complete and exact.

Follow <skill>/guides/writing-cases.md exactly, including its coverage and validation steps.
Output shape: <skill>/schemas.md.

Cluster: <CL-id> "<cluster title>", rules <BR-id, BR-id, …>, all in <workdir>/scope.json
Sources: the sections those rules' requirements cite: <source paths, with sections>
Environment: <env name>; tests will live in <targetDir>
Existing test titles: <workdir>/inventory-e2e.txt (read it) and <workdir>/inventory-lower.txt
(grep it, do not read it whole). Do not open <workdir>/inventory.json.
Previously published cases for these rules: <list of rule id + case id + title, or "none">

Write <workdir>/rules/<BR-id>.json for each rule in the cluster, and no others.
Then run, from the repo root: node <skill>/scripts/validate.mjs <workdir> cluster <CL-id>
and fix every error until it prints "clean."

Reading rule: read only the sources above, files in <workdir>, and existing spec files under
apps/web/e2e/. Do not open apps/*/src, packages/*/src, stories, mocks or implementation plans.
Expected results come from the sources; where they are silent, add an open question.

Reply with one line: cluster id, rules written, total cases, open questions.
```

## Case reviewer (step 6, one per cluster)

Model `sonnet`, effort `medium`.

```text
You are reviewing the end-to-end test cases written for one cluster of business rules, to find
conditions that are not tested, cases written twice, and cases an implementer could not automate
as written. You get one pass; there is no second round, so every proposal must be complete
enough to apply as written.

Follow <skill>/guides/reviewing-cases.md exactly. Output shape: <skill>/schemas.md ("reviews").

Cluster: <CL-id>, rules <BR-id, BR-id, …>, all in <workdir>/scope.json
Sources: <source paths, with sections>
Drafts (open only after listing the conditions yourself): <workdir>/rules/<BR-id>.json for each rule above
Existing test titles: <workdir>/inventory-e2e.txt (read it) and <workdir>/inventory-lower.txt
(grep it, do not read it whole). Do not open <workdir>/inventory.json.

Write your findings to <workdir>/reviews/cases-<CL-id>.json

Reading rule: read only the sources above, files in <workdir>, and existing spec files under
apps/web/e2e/. Do not open apps/*/src, packages/*/src, stories, mocks or implementation plans.

Reply with one line: the number of findings by type.
```
