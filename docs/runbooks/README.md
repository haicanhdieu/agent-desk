# Runbooks

Step-by-step guides for running and operating Agent Desk: start the app, run the tests, reset the database, deploy, respond to an incident. Rules for writing code are elsewhere, in [`docs/conventions/`](../conventions/README.md).

A runbook says **how to do one task**. Write it as numbered steps with commands you can copy, what you should see, and what to do when you don't.

## Local development

| Runbook                                                    | Use it to…                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [local-dev.md](local-dev.md)                               | Start the stack with devbox, sign in, trigger a run through the fake provider, stop and reset |
| [tests-and-e2e.md](tests-and-e2e.md)                       | Run unit/integration tests, mocked e2e and full local e2e; debug failures                     |
| [storybook-and-parity.md](storybook-and-parity.md)         | Run Storybook; screenshot-compare screens with the prototype                                  |
| [database-local.md](database-local.md)                     | Migrate, open psql, query under RLS, reset, add a migration                                   |
| [connect-github-app-local.md](connect-github-app-local.md) | Use a real GitHub App and repo instead of the fake provider (optional)                        |
| [dev-workflow.md](dev-workflow.md)                         | Move a ticket across the board (Ready → In review → QA → Done); run `dev-build`, `dev-review` |
| [agent-model-tiers.md](agent-model-tiers.md)               | Change which model each subagent tier (high, medium, low) uses for the whole team             |

## Operations

| Runbook                                      | Use it to…                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| [incident-response.md](incident-response.md) | Contain and recover from a leaked secret, rogue run or tenant exposure |
| `agentdesk-prereqs.md` _(planned)_           | Prepare the Mac mini host before install                               |
| `agentdesk-install.md` _(planned)_           | First QA install: age key, secrets, tunnel, bootstrap, first sign-in   |
| `agentdesk-operate.md` _(planned)_           | See what's deployed, read logs, roll back, pause, rotate tokens        |
| `agentdesk-capacity.md` _(planned)_          | Measure memory peaks during real runs; tune limits                     |
| `agentdesk-teardown.md` _(planned)_          | Remove the QA install without touching neighbouring workloads          |

The planned ops runbooks are defined in §9.1 of the [infra spec](../superpowers/specs/2026-11-12-infra-design.md).

## Quick reference

```sh
devbox run dev          # start everything (TUI)
devbox run help         # list all devbox scripts
devbox run check        # lint + typecheck + test
devbox run stop         # stop the stack
```

## Writing a runbook

- One task per file, named `<task>.md`. Ops runbooks for a deployment target use the `agentdesk-*.md` prefix.
- Start with one paragraph on what the task achieves and an **Applies to** line.
- Steps are numbered and copy-pasteable. Prefer `devbox run <script>` over raw commands, so commands stay identical for everyone.
- End with a troubleshooting table (symptom → fix).
- Mark steps that depend on unfinished work _(once X lands)_, and remove the mark when X lands.
- Link to the rule in `docs/conventions/` instead of restating it.
