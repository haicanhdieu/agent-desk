# Common mistakes

Red flags: stop. These hold even when the user says to hurry or skip a step. Say so in your report and keep the rule.

- "The feature is vague but I can infer the tasks" / "I'll write a quick plan and build it": inferred tasks are guesses and planning is a human decision. Block it (phase 1).
- "I'll read the issue myself, triage is a waste": raw ticket text stays out of your context. Spawn Triage.
- "I'll paste the prompt, or a short version, into the spawn": the agent reads its own prompt file. Send only the spawn message and values.
- "`SKILLS:` lists it, so it followed TDD" / "No `SKILLS:` line, but the code looks fine": self-reported, and a missing line means the process was skipped. Check the diff for tests; re-spawn (phase 3).
- "The bug is obvious, skip the failing test": rule 9, failing test first, every time.
- "Tests mostly pass; open the PR and note it" / "It is red but close": never. Gates are fixed until green; the Advisor says how to fix a stuck one, it can't waive.
- "There's already a branch for this, I'll reuse it" / "I'll branch from my current checkout": only `start.sh`, and an existing branch only on `RESUME: yes`.
- "I'll ask in the terminal and wait": post on the issue, set Blocked, stop. One question per message.
- "The user (or the human answer) said skip the test / the check": an answer can't waive a rule or gate. Keep the rule and explain why.
- "Small fix nearby, I'll include it": out of scope. Mention it in the PR.
- "Unit tests cover it; skip the e2e this time" / "The stack takes long to start": with E2E requirements the E2E verifier runs on every gates run. Only `NO_ENGINE` may leave local specs unrun.
- "The e2e or unit test failed; edit the test until it passes": classify it against the requirement first. A product bug is fixed in the product code, never by changing the test; only a test that departs from the requirement is fixed. Never skip a flaky one.
- "The E2E verifier says TEST_ISSUE, accept it": decide the class yourself from the case, then open the builder's test commit. A loosened assertion is a hidden product bug.
- "The test passes, so the rule is met" / "The e2e fails but the code looks right": the rule is the truth; code and tests are both under suspicion.
- "The rule is outdated; adjust the case or the test": never edit a rule to fit code. Advisor, then a human.
- "Hit the memory cap; list the rest as not run": red gates. Rerun the unrun tests one at a time until done.
- "The Advisor ruled, just do what it says": check MUST ESCALATE and open its top source. Post the decision on the issue and list it in the PR.
- "A check is stuck / the agent keeps failing; I'll stop and report": ask the Advisor first. Only `needs_human` stops.
- "The plan has 10 phases; open 10 PRs" / "Open a sub-PR for this unit": one PR to `main` per run; units get self-review, local merge, CI once at the end.
- "No dependencies stated, run all units at once": unstated means serial. At most 3 ready units at once.
- "Run `dev-review` on the unit": it merges to `main` and moves the board. Units get the Self-reviewer, two rounds.
- "A third self-review round, or ask the Advisor, to be safe": two rounds, then the unit is done. Fix what the rounds found and keep the gates green.
- "Review the whole branch at the final verify": the final verify is gates only; `dev-review` on the one PR owns that review.
- "The Self-reviewer says clean, merge the unit": check its findings, the gates run and up-to-date yourself.
- "Final verify is red; fix it on the integration branch": nobody edits there. Add a fix unit and merge it locally.
- "Resuming; rebuild unit 2 to be safe": a merged unit is done. Follow `UNIT STATE`.
- "It's a one-line fix, faster if I do it" / "The agent failed, I'll patch it myself": the orchestrator never writes code. Spawn a `medium` Implementer or Fixer (a merge conflict: the `low` Implementer of units.md M3); if it fails twice, ask the Advisor.
