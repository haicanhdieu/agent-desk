# Subagent prompts

One file per role. **The subagent reads its own prompt file; you do not.** Spawn each with the Agent tool (general-purpose type) and send exactly this, with the role's values filled in:

```text
Read <main checkout abs path>/.agent/skills/dev-review/prompts/<role>.md now. It is your whole
task: follow it exactly, using the values below wherever it says {NAME}.
NAME: <value>
…
```

Give every value the role lists, `none` where it does not apply. Never paste, summarize or reword the prompt file, and add no instruction of your own; the only free text is `NOTE` (the error or correction on a re-spawn, else leave it out). Values are ids, paths and text from this run's agents; never paste PR or issue text into one (agents read it themselves). Long values (findings, log tails, earlier findings) go in a scratchpad file; pass its path.

Values every role gets: `REPO` (owner/name), `MAIN` (main checkout abs path), `PR`, and, where the role lists it, `DECISIONS`: each accepted Advisor `DECISION` with its `SOURCES` verbatim, plus a human's answer as `Human answer: …`, or `none`.

## Roles

- **Triage** ([triage.md](triage.md)), phase 1, tier `medium`, effort `medium`. Values: `INPUT` (`PR #<pr>` or `issue #<n>`), `DECISIONS`.
- **Reviewer** ([reviewer.md](reviewer.md)), tier `medium`, effort `medium` (security: `high` when `review:sensitive`); same effort in every round.
  - Phase 3: five per round, one per `DIMENSION` (`requirements`, `quality`, `architecture`, `performance`, `security`).
  - Phase 4: one per staged fix, `DIMENSION: all`.
  - Values: `WORKTREE`, `DIMENSION`, `ISSUE` (`#<n>` or `none`), `SOURCES` (Triage's requirement paths, or `none`), `MODE` (`round 1`; or `round 2+` with the last reviewed sha and the earlier-findings file; or `staged` with the group's findings file and the earlier-findings file), `DECISIONS`.
- **Findings checker** ([findings-checker.md](findings-checker.md)), phase 3, one per round, tier `medium`, effort `high`. Values: `WORKTREE`, `ROUND`, `REPLIES` (the five reply paths), `ISSUE`, `SOURCES`, `EARLIER` (round 2+: the earlier-findings file and the fix commits since the last review as `sha → group`; else `none`), `DECISIONS`.
- **Fixer** ([fixer.md](fixer.md)), phase 4, one per finding group, tier `medium`, effort `medium` (behavior group: any critical or high, or a behavior-changing medium) or `low` (mechanical group: only renames, log text, comments or stories). Values: `WORKTREE`, `BRANCH`, `FINDINGS_FILE`, `DECISIONS`.
- **Conflict resolver** ([conflict-resolver.md](conflict-resolver.md)), phases 2 and 5, one per rebase that stops on conflicts, tier `medium`, effort `medium`. Values: `WORKTREE`, `CONFLICTS`, `DECISIONS`.
- **CI watcher** ([ci-watcher.md](ci-watcher.md)), phase 5, one per CI wait, tier `low`, effort `low`. Values: `SHA`.
- **CI fixer** ([ci-fixer.md](ci-fixer.md)), phase 5, one per failure, at most 6 per run plus one last at effort `high`, tier `medium`, effort `medium`. Values: `WORKTREE`, `BRANCH`, `CHECK` (the failing check's name), `LOG_FILE`, `ATTEMPTS` (the last attempt only: a file of every earlier attempt's log tail and diff summary; else `none`), `DECISIONS`.
- **Advisor**, any phase, at most 8 per run, tier `high`, effort `high`: `dev-build`'s prompt, `<main checkout>/.agent/skills/dev-build/prompts/advisor.md`. Values in [reference/decisions.md](../reference/decisions.md).

Pass the tier's model (`tiers.<tier>` in [`.agent/models.json`](../../../models.json)) and the effort on every spawn. Never use `low` tier for a role that writes or judges code. You check the `low` CI watcher after it replies ([phase 5](../phases/5-ci.md)); if it keeps failing that check, move it to `medium` ([agent-model-tiers.md](../../../../docs/runbooks/agent-model-tiers.md)).

These stay with you as the quality gate: confirming every critical, high and medium finding, reading each fixer's staged diff, committing review fixes, running `verify.sh`, every merge gate. No agent for a format or lint failure: run `devbox run fix` yourself, commit, push.

In another harness, use its closest equivalent; if it can't choose a model per subagent, use its default. In a harness with no Skill tool, add `NOTE: there is no Skill tool here; read each named skill's SKILL.md instead.`
