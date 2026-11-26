# Subagent prompts

One file per role. **The subagent reads its own prompt file; you do not.** Spawn each with the Agent tool (general-purpose type) and send exactly this, with the role's values filled in:

```text
Read <main checkout abs path>/.agent/skills/dev-build/prompts/<role>.md now. It is your whole
task: follow it exactly, using the values below wherever it says {NAME}.
NAME: <value>
…
```

Give every value the role lists, `none` where it does not apply. Never paste, summarize or reword the prompt file, and add no instruction of your own; the only free text is `NOTE` (the error or correction on a re-spawn, else leave it out). Values are ids, paths and text from this run's agents; never paste ticket text into one (agents read the ticket themselves).

Values every role gets: `REPO` (owner/name), `MAIN` (main checkout abs path), and, where the role lists it, `DECISIONS`: each accepted Advisor `DECISION` with its `SOURCES` verbatim, plus a human's answer as `Human answer: …`, or `none`.

## Roles

The Implementer, Fixer and Self-reviewer all read [common.md](common.md) (untrusted text, requirement beats code, TDD, E2E rules, decisions) first; role files hold only what is specific to the role.

- **Triage** ([triage.md](triage.md)), phase 1, tier `medium`, effort `high`. Values: `N`, `DECISIONS`.
- **Fixer** ([fixer.md](fixer.md)), phase 3, one per bug, tier `medium`, effort `high`. Values: `N`, `WORKTREE`, `BRANCH`, `DECISIONS`, `FINDINGS_FILE` (a scratchpad path on a re-spawn for failures or findings, else `none`).
- **Implementer** ([implementer.md](implementer.md)), phase 3, one per task, tier `medium`, effort `medium`. Values: `N`, `WORKTREE`, `BRANCH`, `BASE` (`origin/main`, or `origin/<integration>` for a unit), `TASK` (`<k> of <total>`, plus `of unit U<id>`, and the task's title), `TASK_SOURCE` (`issue body`, or the plan path and task heading), `E2E_FILES` (Triage's `E2E REQUIREMENTS` paths, or `none`), `DECISIONS`, `FINDINGS_FILE`.
- **E2E verifier** ([e2e-verifier.md](e2e-verifier.md)), phase 4 gates and the final verify (M5), one per gates run, only with E2E requirements, tier `medium`, effort `medium`. Values: `WORKTREE`, `BRANCH`, `BASE`, `E2E_FILES`, `INTEGRATION` (`yes` at the final verify of several units, else `no`), `RERUN` (test titles left without a result by an earlier run, else `none`).
- **Self-reviewer** ([self-reviewer.md](self-reviewer.md)), unit loop step 3B, at most 2 per unit, tier `medium`, effort `medium` (`high` when sensitive). Values: `N`, `UNIT` (`U<id> of <total>`, or `single`), `WORKTREE`, `BRANCH`, `BASE`, `KIND` (`bug` or `feature`), `TASKS` (bug: `the behavior the issue reports`; feature: the task source and the task titles, for a unit only its own), `ROUND` (`1`, or `2` with the scratchpad file of round 1 findings and how each was resolved), `SINCE` (round 2: the head round 1 reviewed; else `none`), `SENSITIVE` (`yes` with the files, or `no`), `E2E_FILES`, `E2E_SCOPE` (`all`, or the ids a unit's tasks name, or `none named by this unit`), `DECISIONS`.
- **PR agent** ([pr-agent.md](pr-agent.md)), phase 5, tier `low`, effort `low`. Values: `N`, `WORKTREE`, `BRANCH`, `TYPE` (`bugfix` or `feature`), `VERIFY` (the head `verify.sh` passed on and its log path), `SUMMARY`, `ROOT_CAUSE` (bug), `PLAN`, `JUDGMENT_CALLS`, `E2E`, and for multi-unit `UNITS`, `SENSITIVE`, `DECLINED`.
- **Advisor** ([advisor.md](advisor.md)), any phase, only for would-be-human questions, at most 8 per run, tier `high`, effort `high`. Values in [reference/decisions.md](../reference/decisions.md).

Pass the tier's model (`tiers.<tier>` in [`.agent/models.json`](../../../models.json)) and the effort on every spawn. Never use `low` for a role that writes or judges code. You check the `low` PR agent after it replies ([phase 5](../phases/5-open-pr.md)); if it keeps failing that check, move it to `medium` ([agent-model-tiers.md](../../../../docs/runbooks/agent-model-tiers.md)).

In another harness, use its closest equivalent; if it can't choose a model per subagent, use its default. In a harness with no Skill tool, add `NOTE: there is no Skill tool here; read each named skill's SKILL.md instead.`
