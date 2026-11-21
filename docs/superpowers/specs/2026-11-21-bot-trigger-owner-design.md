# Bot trigger owner from the linked issue: design

Status: draft. Sensitive paths: auth and run ownership (`access/run-owner.ts`), webhooks and polling intake
(`intake/process-ticket-event.ts`).
Source: PRs #209 and #210. Decision record: [ADR 0033](../../adr/0033-bot-trigger-owner-from-linked-issue.md).
Amends: [rbac-foundation design](2026-11-20-rbac-foundation-design.md) (bot-authored triggers, and "no comment is posted
on a refused trigger").

## Summary

When a build posts `/dev-review` on the PR it opened, the review starts as the person who triggered the build, even if
other builds run at the same time. When the desk cannot tell who that is, it says so on the PR instead of staying silent.

## Business rules

| Id   | Rule |
| ---- | ---- |
| BO-1 | A bot comment trigger on a PR whose linked issue has runs owned by one person starts a run owned by that person, whatever other runs are active in the project. |
| BO-2 | A bot comment trigger on a PR whose linked issues have several runs, of one owner or of several, starts a run owned by the owner of the nearest one: the run that started last at or before the comment. |
| BO-3 | A bot comment trigger with no linked-issue match keeps today's rules: the single active run on the ticket, else the single active run in the project, else no owner. |
| BO-4 | When a bot comment trigger ends as `ignored_owner_unlinked`, one comment is posted on that ticket: "Agent Desk did not start this command: it could not work out which person's run posted the comment, so there is no owner to start it as. Post the command again yourself to start it." It is posted once per trigger comment, never for a human trigger, never for another outcome, and it does not start a run. |
| BO-5 | The owner must still hold `run:create` on the project (unchanged); a bot comment whose owner lacks it is `ignored_owner_not_permitted` and gets no notice. |

## Not in scope

- Following a chain longer than the PR's own links (an issue linked to a parent issue): the board gives only the PR's direct links.
- A notice for `ignored_owner_not_permitted` or for a refused human trigger.
- Removing the project-wide fallback (Agent call: kept so no existing hand-off breaks; revisit with the human).
- Putting a marker in the bot comment (rejected in the rbac-foundation design: the model may not comply and it can be copied).

## Needs approval

None. No new dependency.
