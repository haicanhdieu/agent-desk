# 0034. A bot trigger on a PR takes its owner from the PR's linked issue

- Status: Proposed
- Date: 2026-11-21
- Source: PRs #209 and #210 (a bot `/dev-review` comment started nothing)
- Amends: [0031](0031-scoped-rbac-roles-assignments.md)

## Context

ADR 0031 gives a bot-authored trigger comment the owner of the run that wrote it. The desk finds that run by time only
(`findOrigin` in `packages/core/src/access/run-owner.ts`): the single run active at the comment's time on the same
ticket, else the single one in the project, else no origin and the comment is ignored as `ignored_owner_unlinked`.

A `/dev-build` run on issue #208 comments `/dev-review` on the PR it opened (#209). The PR is a different ticket from
the issue, so the same-ticket lookup finds nothing and the project-wide lookup finds every other active build. While
builds #67 and #68 overlapped, both PR comments saw two candidates and were dropped. The refusal is silent: nothing on
the PR says why.

## Decision

For a bot-authored trigger on a PR, the owner comes first from the PR's linked issue, then from the existing time match.

1. When the PR links to issues (`Ticket.linkedRefs`, normalised by `normalizeLinkedRefs`), the candidates are the runs
   of this project on those issues that started at or before the comment's time and have an owner, finished or not. The
   nearest one wins: the candidate that started last is the origin run and its owner owns the new run, however many
   issues or runs are linked and whatever other runs are active. Only the PR's direct links are followed, not a longer
   chain of issues behind them.
2. Otherwise a single active run on the comment's own ticket wins (unchanged; two or more there is no origin).
3. Otherwise the existing project-wide single-active-run match applies, unchanged.

When a bot-authored trigger ends as `ignored_owner_unlinked`, the desk posts one fixed-text comment on that ticket:
the command was not started because no owner could be detected, and a person can post it again. The text has no ticket,
comment or command text in it and does not start with a command, so it cannot start a run. It is posted once per
trigger comment, after the intake transaction commits. A refused human trigger stays silent, as in 0031.

For a bot-authored trigger the desk now fetches the ticket before it resolves the owner. A human trigger still resolves
the owner first, so an untrusted commenter cannot make the desk call the board.

## Consequences

- Overlapping builds no longer break the build-to-review hand-off. The owner is the person who triggered the issue's run.
- The time match stays as a fallback and keeps its residual risk (a pod can time a comment so another active run is the
  only match).
- The linked-issue step adds reach. A pod can name an issue in its PR body, so the owner of the latest run on that issue,
  even a finished one, can become the owner of a bot-triggered run. The owner must still hold `run:create` on the
  project (unchanged check). Human decision: accepted, because it is what makes the build-to-review hand-off work when
  the build has already finished.
- When a PR's linked issues have runs of different owners, the owner of the latest run wins. That is a judgment call:
  the latest run is the nearest to the comment, not proof it wrote it.
- Comments on refusal are a new board write on the intake path; a failed or slow post is logged by error name and never
  changes the outcome.
