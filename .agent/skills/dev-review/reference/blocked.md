# Blocked

1. Post **Blocked** ([templates/comments.md](../templates/comments.md#blocked-on-the-pr)) on the PR (plain language, one question: [AGENTS.md › Talking to humans](../../../../AGENTS.md#talking-to-humans)). Check first: one question, Problem at most 2 sentences, at most 3 one-line Solutions, one-line Suggestion, nothing secret. Further questions wait for the next run.
2. Push the work that passed review and verification (`--force-with-lease`). Never commit or push a failing or unreviewed fix: discard a staged fix that hasn't passed its diff review (`git -C <worktree> restore --staged --worktree -- <files>`) and name its finding in the comment; the next run reviews from scratch. Keep the worktree clean; the next run reuses it (`start.sh` refuses a dirty one).
3. `board.sh status <n> Blocked` (skip if no linked issue).
4. Report and stop. Do not merge.
