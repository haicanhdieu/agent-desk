# Subagent prompts

Spawn each with the Agent tool. Fill the `<…>` slots and send the prompt as written. Paths are absolute so the subagent needs no other context. `<skill>` is this skill's directory.

Every prompt carries the reading rule, because a subagent does not inherit it from you.

`<source list>` is every entry of `scope.json` `sources`, with its sections: the scope doc **and** the sibling specs, ADRs, PRD or Architecture sections and prototype boards found in step 0 of [guides/extracting-rules.md](guides/extracting-rules.md). Never pass only the sections the scope doc cites; a subagent that sees only the scope doc asks questions the sibling sources answer.

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

Sources to read (scope doc, then sibling specs, ADRs and prototype boards): <source list>
Draft to review (open only after your blind pass): <workdir>/scope.json

Write your blind list to <workdir>/reviews/rules-blind.md
Write your findings to <workdir>/reviews/rules.json

Resolve before asking: the product is built on all of these sources, so a detail the scope doc
leaves out (a label, a format, an empty, loading or error state) is answered by a sibling source
when one states it. Report every open question in the draft that a listed source answers, quoting
that source, and every rule split finer than its outcomes can fail (by field, by message type, per
column). An open question lives once in the scope.json openQuestions registry, with "about"
listing every requirement or rule it touches; report a question registered twice.

Reading rule: read only the sources above, any other file under docs/superpowers/specs/, docs/adr/
or the "docs/Agent Desk — *" docs that covers the same feature, the prototype boards they cite, and
files in <workdir> (not inventory.json). Do not open apps/*/src, packages/*/src, stories, mocks,
fixtures, implementation plans (docs/superpowers/plans/) or the running app; the implementation
may be wrong.

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
Sources (scope doc, then sibling specs, ADRs and prototype boards): <source list>
Open questions already registered: the registry in <workdir>/scope.json
Environment: <env name>; tests will live in <targetDir>
Existing test titles: <workdir>/inventory-e2e.txt (read it) and <workdir>/inventory-lower.txt
(grep it, do not read it whole). Do not open <workdir>/inventory.json.
Previously published cases for these rules: <list of rule id + case id + title, or "none">

Write <workdir>/rules/<BR-id>.json for each rule in the cluster, and no others.
Then run, from the repo root: node <skill>/scripts/validate.mjs <workdir> cluster <CL-id>
and fix every error until it prints "clean.", and every warning that a question or case note
restates a registry question.

Resolve before asking: before any open question, and before naming a label, format, state or
control, check the registry, then search the sources above (and the other specs, ADRs and
PRD/Architecture docs) and open the boards they cite. Where a source answers, use its wording and
cite file and section in the case note. Where none does, do not block the case: follow the closest
stated convention, assert only what the sources support (format-agnostic where the format is
unstated), reference the registry question as {"ref":"Qn"} and note the dependent case "Depends
on Qn". Write a new per-rule question only when the registry has none; if it touches several of
your rules, write it under the first only and name the others in your reply. Never restate a
registry question.

Reading rule: read only the requirement sources above, any other file under docs/superpowers/specs/,
docs/adr/ or the "docs/Agent Desk — *" docs that covers your rules, the prototype boards they cite,
files in <workdir> (not inventory.json), and existing spec files under apps/web/e2e/ (to confirm
coverage only, never to learn an expected result). Do not open apps/*/src, packages/*/src, stories,
mocks, fixtures, implementation plans (docs/superpowers/plans/) or the running app.

Reply with one line: cluster id, rules written, total cases, new per-rule open questions, registry
questions referenced. Add one more line per gap that touches more than one rule, and per behaviour
that belongs to no rule in your cluster.
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
Sources (scope doc, then sibling specs, ADRs and prototype boards): <source list>
Open questions already registered: the registry in <workdir>/scope.json
Drafts (open only after listing the conditions yourself): <workdir>/rules/<BR-id>.json for each rule above
Existing test titles: <workdir>/inventory-e2e.txt (read it) and <workdir>/inventory-lower.txt
(grep it, do not read it whole). Do not open <workdir>/inventory.json.

Write your findings to <workdir>/reviews/cases-<CL-id>.json

Resolve before asking: a label, format or state that a listed source states must appear in the
cases as stated, not as an open question; report any open question a source answers, quoting the
source. A condition must not be left without a case because a detail is unstated: its case should follow
the closest stated convention and assert format-agnostically. A rule file must reference a registry
question as {"ref":"Qn"}, never restate it; report each restatement or repeat as the guide says.

Reading rule: read only the requirement sources above, any other file under docs/superpowers/specs/,
docs/adr/ or the "docs/Agent Desk — *" docs that covers these rules, the prototype boards they cite,
files in <workdir> (not inventory.json), and existing spec files under apps/web/e2e/ (to confirm
coverage only). Do not open apps/*/src, packages/*/src, stories, mocks, fixtures, implementation
plans (docs/superpowers/plans/) or the running app.

Reply with one line: the number of findings by type.
```
