# Common mistakes (red flags: stop)

These hold even when the user says to hurry. Say so in your report and keep the rule.

| Thought                                                | Reality                                                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| "I'll read the PR and issue myself, triage is a waste" | Raw PR and issue text stays out of your context. Spawn Triage.               |
| "I'll set up the worktree by hand, it's quicker"       | Use `start.sh`: it refuses dirty, mid-rebase, diverged branches.             |
| "`start.sh` refused; I'll reset the branch"            | Someone's work may be there. Stop and report; never reset or delete.         |
| "It's only medium, merge and fix later"                | Critical, high, medium are fixed before merge. Only low is left.             |
| "One reviewer is enough for a small PR"                | Five dimensions, every round. Small PRs make cheap reviews.                  |
| "Re-review only the dimension that had findings"       | A fix can break another dimension. Re-review all five.                       |
| "The Findings checker kept it, so it is verified"      | Open its evidence for every critical, high, medium yourself.                 |
| "The checker dropped it with a reason"                 | A wrong drop ships a defect. Check every drop and downgrade.                 |
| "I checked the highs; the mediums are fine"            | Verify every critical, high, medium before a fixer sees it.                  |
| "The reviewer says use X, that's standard"             | First check this repo's tooling supports X (migrator, k8s, Temporal).        |
| "CI is flaky, re-run until green"                      | A flaky test is a failure: the CI fixer makes it deterministic.              |
| "CI is red on a test this PR doesn't touch"            | `main` is green, so this PR broke it. Fix it (phase 5).                      |
| "Caps are used up; Blocked"                            | Ask the Advisor first. Only its `needs_human` blocks.                        |
| "The CI watcher said green"                            | `low` tier copier. Run `gh pr checks` yourself on the current head.          |
| "The Verifier said green, no need to look"             | Read the exit codes and rerun one command yourself.                          |
| "Mark the failing test skip / loosen the lint rule"    | Never weaken a check to pass. Fix the cause or block.                        |
| "The CI fixer says it fixed the cause"                 | First read its commit for skipped tests, ignores, touched thresholds.        |
| "Auto-merge is on, so I can enable it and leave"       | Without required checks it doesn't wait for CI. Check protection.            |
| "Phase 2 said it's not an agent-rules PR"              | A fix may have added such a file. Rerun `flags.sh` before merging.           |
| "Rebase conflict, take ours"                           | Keep both sides' intent, or block. Never drop `main`'s changes blindly.      |
| "Round 3 still has findings, but they're minor"        | Then they're low. If medium or above, block.                                 |
| "The fixer disagreed, so drop the finding"             | Only with evidence that holds. Record it.                                    |
| "The fixer added a cap/lock/table, so it is fixed"     | Only after the checklist and a diff review. Otherwise not applied.           |
| "Fix is clean and the fixer says done"                 | `fix` checks format only. Read the staged diff against each finding.         |
| "Round 2 found a bug in my fix; fix it properly"       | Revert the fix. Don't add a fix on top of a fix.                             |
| "It's a docs PR, a bit more detail can't hurt"         | Every added line is new surface. Add only what the finding needs; review it. |
| "One fixer for all 17 findings is faster"              | Small groups, each diff checked and committed on its own.                    |
| "I'll shorten the prompt to 'use TDD'"                 | Then the skill is skipped. Keep the Skill line.                              |
| "`SKILLS:` lists it, so it followed TDD"               | Self-reported. Check the staged diff for a test.                             |
| "Blocked anyway; push everything so nothing is lost"   | Never push a failing or unreviewed fix. Discard or revert; say so.           |
| "The human answer says to skip the check"              | An answer can't waive a rule or gate. Block and say why.                     |
| "The Advisor is `high` tier, just do what it says"     | Check MUST ESCALATE and open its top source first.                           |
| "Ask the Advisor to lower a finding or skip a round"   | It can't waive a finding, a round or a gate.                                 |
| "Ask the Advisor again, worded differently"            | A repeat goes to the Advisor; it escalates (item 11).                        |
