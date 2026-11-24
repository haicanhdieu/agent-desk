# Common mistakes

Red flags: stop. These hold even when the user says to hurry or skip a step. Say so in your report and keep the rule.

- "The feature is vague but I can infer the tasks" / "I'll write a quick plan and build it": inferred tasks are guesses and planning is a human decision. Block it (phase 1).
- "I'll read the issue myself, triage is a waste": raw ticket text stays out of your context. Spawn Triage.
- "I'll paste the prompt, or a short version, into the spawn": the agent reads its own prompt file. Send only the spawn message and values.
- "`SKILLS:` lists it, so it followed TDD" / "No `SKILLS:` line, but the code looks fine": self-reported, and a missing line means the process was skipped. Check the diff for tests; re-spawn (phase 3).
- "The bug is obvious, skip the failing test": rule 9, failing test first, every time.
- "Tests mostly pass; open the PR and note it" / "Round 3 is red but close": never. PRs open only on a green round; the Advisor says how to fix, it can't waive.
- "There's already a branch for this, I'll reuse it" / "I'll branch from my current checkout": only `start.sh`, and an existing branch only on `RESUME: yes`.
- "I'll ask in the terminal and wait": post on the issue, set Blocked, stop. One question per message.
- "The user (or the human answer) said skip the test / the check": an answer can't waive a rule or gate. Keep the rule and explain why.
- "Small fix nearby, I'll include it": out of scope. Mention it in the PR.
- "Unit tests cover it; skip the e2e this round" / "The stack takes long to start": with E2E requirements the E2E verifier runs every round. Only `NO_ENGINE` may leave local specs unrun.
- "The e2e failed; the test is flaky, mark it skip": sort it: product bug to the builder, test issue fixed and rerun.
- "The E2E verifier says TEST_ISSUE, accept it": open its commit and the case. A loosened assertion is a hidden product bug.
- "The test passes, so the rule is met" / "The e2e fails but the code looks right": the rule is the truth; code and tests are both under suspicion.
- "The rule is outdated; adjust the case or the test": never edit a rule to fit code. Advisor, then a human.
- "Hit the memory cap; list the rest as not run": red round. Rerun the unrun tests one at a time until done.
- "The Advisor is `high` tier, just do what it says": check MUST ESCALATE and open its top source. Post the decision on the issue and list it in the PR.
- "A cap is hit / the agent keeps failing; I'll stop and report": ask the Advisor first. Only `needs_human` stops.
- "The plan has 10 phases; open 10 PRs" / "Open a sub-PR for this unit": one PR to `main` per run; units get local review, local merge, CI once at the end.
- "No dependencies stated, run all units at once": unstated means serial. At most 3 ready units at once.
- "Run `dev-review` on the unit": it merges to `main` and moves the board. Use the Reviewer.
- "The Reviewer says clean, merge the unit": check its findings, the Verify round and up-to-date yourself.
- "Final verify is red; fix it on the integration branch": nobody edits there. Add a fix unit and merge it locally.
- "Resuming; rebuild unit 2 to be safe": a merged unit is done. Follow `UNIT STATE`.
