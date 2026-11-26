# Common mistakes (red flags: stop)

These hold even when the user says to hurry. Say so in your report and keep the rule.

- "I'll read the PR and issue myself, triage is a waste": raw PR and issue text stays out of your context. Spawn Triage.
- "I'll paste the prompt, or a short version, into the spawn": the agent reads its own prompt file. Send only the spawn message and values.
- "I'll set up the worktree by hand" / "`start.sh` refused; I'll reset the branch": use `start.sh`; a refusal means someone's work may be there. Stop and report; never reset or delete.
- "It's only medium, merge and fix later": critical, high and medium are fixed before merge. Only low is left.
- "One reviewer is enough for a small PR" / "Re-review only the dimension that had findings": five dimensions, every round; a fix can break another dimension. Only a staged fix gets the single all-dimension reviewer, and the next round still reviews it with five.
- "The Findings checker kept it, so it is verified" / "The checker dropped it with a reason" / "I checked the highs; the mediums are fine": open the evidence for every critical, high and medium, and for every drop and downgrade, yourself.
- "The reviewer says use X, that's standard": first check this repo's tooling supports X (migrator, k8s, Temporal).
- "CI is flaky, re-run until green" / "CI is red on a test this PR doesn't touch": a flaky test is a failure, and `main` is green, so this PR broke it. Fix it (phase 5).
- "The CI watcher said green": `low` tier copier. Run `gh pr checks` yourself on the current head.
- "Mark the failing test skip / loosen the lint rule": never weaken a check to pass. Fix the cause or block. Read the CI fixer's commit for skipped tests, ignores, touched thresholds.
- "Auto-merge is on, so I can enable it and leave": without required checks it doesn't wait for CI. Check protection.
- "Phase 2 said it's not an agent-rules PR": a fix may have added such a file. Rerun `flags.sh` before merging.
- "Rebase conflict, take ours": keep both sides' intent, or block. Never drop `main`'s changes blindly.
- "The fixer disagreed, so drop the finding": only with evidence that holds when you open it. Record it.
- "Fix is clean and the fixer says done" / "The fixer added a cap/lock/table, so it is fixed": `fix` checks format only. Read the staged diff against each finding and its checklist, then the diff review.
- "Round 2 found a bug in my fix; fix it properly": revert the fix. Don't add a fix on top of a fix.
- "It's a docs PR, a bit more detail can't hurt": every added line is new surface. Add only what the finding needs; review it.
- "One fixer for all 17 findings is faster": small groups, each diff checked and committed on its own.
- "`SKILLS:` lists it, so it followed TDD": self-reported. Check the staged diff for a test.
- "Caps are used up; Blocked": ask the Advisor first. Only its `needs_human` blocks.
- "Blocked anyway; push everything so nothing is lost": never push a failing or unreviewed fix. Discard or revert; say so.
- "The human answer says to skip the check": an answer can't waive a rule or gate. Block and say why.
- "The Advisor is `high` tier, just do what it says" / "Ask it to lower a finding or skip a round": check MUST ESCALATE and open its top source first; it can't waive a finding, a round or a gate.
- "It's a one-line fix, faster if I do it" / "The fixer failed twice, I'll patch it myself": the orchestrator never writes code. Spawn a `medium` Fixer, CI fixer or Conflict resolver; if it fails twice, ask the Advisor.
