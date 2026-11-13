# Subagent prompts

Fill the `<…>` slots and send the prompt as written. Paths are absolute so the subagent needs no other context. `<skill>` is this skill's directory.

Every prompt carries the same reading rule, because a subagent does not inherit it from you.

## Rule reviewer (step 3)

```text
You are reviewing a list of business rules extracted from requirement documents, to make sure
nothing is missed and nothing is invented. Test cases will be written from this list, so a rule
missing here is behaviour that never gets tested.

Follow <skill>/guides/reviewing-rules.md exactly. Output shape: <skill>/schemas.md.

Sources to read: <source paths, with sections>
Draft to review (open only after your blind pass): <workdir>/scope.json
Round: <n>
Earlier findings and their resolutions: <paths, or "none">

Write your blind list to <workdir>/reviews/rules-blind-round-<n>.md
Write your findings to <workdir>/reviews/rules-round-<n>.json

Reading rule: read only the sources above and files in <workdir>. Do not open apps/*/src,
packages/*/src, stories, mocks or implementation plans; the implementation may be wrong.

Reply with one line: the number of findings by type.
```

## Case writer (step 5, one per rule)

```text
You are writing end-to-end test cases for one business rule. An engineer or agent will later
automate them from a GitHub issue without asking you anything, so each case must be complete
and exact.

Follow <skill>/guides/writing-cases.md exactly, including its coverage and validation steps.
Output shape: <skill>/schemas.md.

Rule: <BR-id> in <workdir>/scope.json (read the whole file for context; write cases only for this rule)
Sources: <source paths, with sections>
Environment: <env name>; tests will live in <targetDir>
Existing test titles: <workdir>/inventory.json
Previously published cases for this rule: <list of id + title, or "none">
Review findings to apply: <path, or "none">

Write <workdir>/rules/<BR-id>.json
Then run: node <skill>/scripts/validate.mjs <workdir> case <BR-id>   (from the repo root) and fix every error.

Reading rule: read only the sources above, files in <workdir>, and existing spec files under
apps/web/e2e/. Do not open apps/*/src, packages/*/src, stories, mocks or implementation plans.
Expected results come from the sources; where they are silent, add an open question.

Reply with one line: rule id, number of cases, number of open questions.
```

## Case reviewer (step 6, one per rule)

```text
You are reviewing the end-to-end test cases written for one business rule, to find conditions
that are not tested and cases an implementer could not automate as written.

Follow <skill>/guides/reviewing-cases.md ("Reviewing one rule") exactly. Output shape: <skill>/schemas.md.

Rule: <BR-id> in <workdir>/scope.json
Sources: <source paths, with sections>
Draft to review (open only after listing the conditions yourself): <workdir>/rules/<BR-id>.json
Existing test titles: <workdir>/inventory.json
Round: <n>
Earlier findings and their resolutions: <path, or "none">

Write your findings to <workdir>/reviews/cases-<BR-id>-round-<n>.json

Reading rule: read only the sources above, files in <workdir>, and existing spec files under
apps/web/e2e/. Do not open apps/*/src, packages/*/src, stories, mocks or implementation plans.

Reply with one line: the number of findings by type.
```

## Cross-rule reviewer (step 7, once)

```text
You are checking a full set of end-to-end test cases, grouped by business rule, for problems
that span rules: the same case written under two rules, and behaviour that falls between rules.

Follow <skill>/guides/reviewing-cases.md ("Cross-rule pass") exactly. Output shape: <skill>/schemas.md.

Requirements and rules: <workdir>/scope.json
Cases: every file in <workdir>/rules/
Sources: <source paths, with sections>

Write your findings to <workdir>/reviews/cases-cross.json

Reading rule: read only the sources above and files in <workdir>. Do not open apps/*/src,
packages/*/src, stories, mocks or implementation plans.

Reply with one line: the number of findings by type.
```
