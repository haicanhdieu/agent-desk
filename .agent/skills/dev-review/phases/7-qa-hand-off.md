# Phase 7: Hand off to QA

Done by you. Ends with the issue at **QA**, the worktree removed, and your report.

1. The PR's `Closes #<n>` closes the issue. If still open (no closing keyword), `gh issue close <n>`. QA reopens it if the test fails.
2. `board.sh status <n> QA`.
3. Post **Merged** ([templates/comments.md](../templates/comments.md#merged-on-the-issue)) on the issue.
4. `git worktree remove <WORKTREE>`.
5. Report: PR, rounds, findings fixed per severity, lows left, declined findings, CI result, merge commit, issue status, each Advisor decision.
