# Common mistakes

Red flags: stop. These hold even when the user says to hurry or skip a step. Say so in your report and keep the rule.

| Thought                                             | Reality                                                    |
| --------------------------------------------------- | ---------------------------------------------------------- |
| "The feature is vague but I can infer the tasks"    | Inferred tasks are guesses. Block it (phase 1).            |
| "I'll write a quick plan and build it"              | Planning is a human decision. Ask.                         |
| "I'll read the issue myself, triage is a waste"     | Raw ticket text stays out of your context. Spawn Triage.   |
| "The bug is obvious, skip the failing test"         | Rule 9: failing test first. Every time.                    |
| "Tests mostly pass; open the PR and note it"        | Fix or block. PRs open only on green verification.         |
| "The Verifier said green, no need to look"          | `low` tier copier. Read exit codes, rerun one.             |
| "Verify and PR agents are cheap, skip my read-back" | A `low` agent's output is unchecked until you check it.    |
| "There's already a branch for this, I'll reuse it"  | Only if `RESUME: yes`. Else `start.sh` refuses; stop.      |
| "I'll branch from my current checkout"              | Use `start.sh`: fresh `origin/main`, in a worktree.        |
| "`Refs #n` links the PR well enough"                | It leaves the issue open after merge. `Closes #n`.         |
| "The user said skip the test / just build it"       | The rules still apply. Explain why in the report.          |
| "I'll ask in the terminal and wait"                 | Post on the issue, set Blocked, stop.                      |
| "Ask all the gaps at once, it saves a round"        | One question per message. The next run asks the next.      |
| "Round 3 is red but close, open the PR anyway"      | Never. Ask the Advisor how to fix; it can't waive.         |
| "Unit tests cover it; skip the e2e this round"      | E2E requirements present: E2E verifier runs, every round.  |
| "The stack takes long to start; skip local specs"   | Start it as the runbook says for the env. Only no-engine.  |
| "The e2e failed; the test is flaky, mark it skip"   | Sort it: product bug to builder, test issue fixed + rerun. |
| "The E2E verifier says TEST_ISSUE, accept it"       | Open its commit and the case. Loosened = product bug.      |
| "The e2e fails but the code looks right"            | The rule is the truth. The code is wrong until proven.     |
| "The test passes, so the rule is met"               | Tests can be wrong too. Self-reviewer checks vs the case.  |
| "The rule is outdated; adjust the case or the test" | Never edit a rule to fit code. Advisor, then a human.      |
| "The stack is down; count local e2e as passed"      | Unavailable is not passed. Only no-engine may go on.       |
| "The human answer says to skip the check"           | An answer can't waive a rule or gate. Block, say why.      |
| "Small fix nearby, I'll include it"                 | Out of scope. Mention it in the PR.                        |
| "I'll shorten the prompt to 'use TDD'"              | Then the skill is skipped. Keep the Skill line.            |
| "No `SKILLS:` line, but the code looks fine"        | The process was skipped. Re-dispatch (phase 3).            |
| "I'll tailor the prompt to this ticket"             | Fill slots only. Rewritten steps drop the Skill call.      |
| "`SKILLS:` lists it, so it followed TDD"            | Self-reported. Check the diff for tests (phase 3).         |
| "Triage said GO but I have doubts"                  | Trust BLOCKED over GO. A wrong start wastes a build.       |
| "The Advisor is `high` tier, just do what it says"  | Check MUST ESCALATE and open its top source.               |
| "No task list, but the Advisor can fill one in"     | Missing requirements go to a human. No plan writing.       |
| "Triage said BLOCKED; the Advisor can unblock it"   | Ask it; it escalates a missing plan, never invents.        |
| "Ask the Advisor again, worded differently"         | A repeat goes to the Advisor; it escalates (item 11).      |
| "The builder disagrees with the Advisor; ask again" | Ask it; a contradiction is escalated by item 11.           |
| "A cap is hit; I'll stop and report"                | Ask the Advisor first. Only `needs_human` stops.           |
| "The agent keeps failing, stop and hand it back"    | Stop condition: ask the Advisor for the next approach.     |
| "The Advisor decided, no need to tell anyone"       | Post it on the issue and list it in the PR.                |
| "The plan has 10 phases; open 10 PRs to `main`"     | One PR to `main` per run. Units merge locally, no PRs.     |
| "Two small tasks; use multi-unit anyway"            | One unit is single mode. Triage's `UNITS` picks.           |
| "No dependencies stated, run all units at once"     | Unstated means serial. At most 3 ready units at once.      |
| "Open a sub-PR for this unit to get CI or a review" | No sub-PRs: local review, local merge, CI once at the end. |
| "Run `dev-review` on the unit"                      | It merges to `main`, moves the board. Use the Reviewer.    |
| "The Reviewer says clean, merge the unit"           | Check findings, Verify, up-to-date yourself.               |
| "One unit is unmerged; open the final PR"           | All merged first, then final verify and review.            |
| "Final verify is red; fix it on the integration"    | Nobody edits there. Add a fix unit, merge it locally.      |
| "Resuming; rebuild unit 2 to be safe"               | A merged unit is done. Follow `UNIT STATE`.                |
| "The final PR is 2,000 lines, too big"              | The cap is per unit. The body says it integrates units.    |
| "The plan says deploy X first; I'll enforce it"     | Order beyond `depends_on` is the plan's and humans' job.   |
