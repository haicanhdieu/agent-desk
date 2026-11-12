# Conventions

The rules for writing code in Agent Desk: guardrails, coding conventions, and the review checklist. Humans and AI agents follow the same documents. For how to run things (start the app, run e2e, reset the database), see [`docs/runbooks/`](../runbooks/README.md).

Start at [`AGENTS.md`](../../AGENTS.md) for the short version.

| Doc                                                  | Read it when you…                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                   | add a package, module, table, route, provider or workflow; wonder where code goes       |
| [security.md](security.md)                           | touch secrets, tokens, auth, webhooks, the run pod/Job, the terminal, or untrusted text |
| [typescript.md](typescript.md)                       | write any TypeScript (all packages)                                                     |
| [backend.md](backend.md)                             | work in `apps/api`, `apps/worker`, or server-side `packages/core`                       |
| [database.md](database.md)                           | change the schema, write a migration, or write a query                                  |
| [frontend.md](frontend.md)                           | work in `apps/web` or the contracts client                                              |
| [testing.md](testing.md)                             | write or fix tests, or fix a bug (test first)                                           |
| [git-workflow.md](git-workflow.md)                   | branch, commit, open or merge a PR; decide whether a spec/plan/ADR is required          |
| [code-review-checklist.md](code-review-checklist.md) | review a PR, or self-check before asking for review                                     |

The PR template ([`.github/pull_request_template.md`](../../.github/pull_request_template.md)) is the short form of the review checklist.

## Related

- Decisions and their rationale: [`docs/adr/`](../adr/README.md)
- Feature specs and implementation plans: [`docs/superpowers/`](../superpowers/)

## Maintaining these docs

- Rules use **MUST / MUST NOT / SHOULD**, each with a one-line why. Enforcement that doesn't exist yet is marked **(planned)**.
- Keep commands out of conventions; put them in a runbook and link to it.
- When a rule changes, update the convention in the same PR as the code. When a rule follows from a decision, link the ADR.
- If a convention and a spec disagree, the newer accepted doc wins. Fix the stale one; don't leave both.
