# Agent Desk

**Turn tickets into Claude Code runs, each in its own Kubernetes sandbox, that you can watch and attach to.**

[![CI](https://github.com/haicanhdieu/agent-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/haicanhdieu/agent-desk/actions/workflows/ci.yml) [![GitHub Stars](https://img.shields.io/github/stars/haicanhdieu/agent-desk)](https://github.com/haicanhdieu/agent-desk/stargazers) [![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

[Quick Start](#quick-start) · [Usage](#usage) · [How It Works](#how-it-works) · [Documentation](#documentation) · [Contributing](AGENTS.md)

Agent Desk lets you delegate work to AI coding agents through the ticket board your team already uses. You write the skills an agent follows and the routing rules that pick them. Agent Desk then runs each ticket as an isolated Kubernetes Job, writes the result back to the ticket, and shows every run live in a web dashboard.

> **Status:** proof of concept, moving toward a multi-tenant product. Expect breaking changes.

## Example: a ticket that starts an agent

A skill is a procedure saved in your repo at `<name>/SKILL.md` under the project's default agent folder (`.claude/skills/` for Claude Code; Codex and OpenCode also read `.agents/skills/`). A routing rule says "when a ticket comment matches X, run skill Y with agent Z". With a `code-review` skill and a matching rule, a comment on a pull request is all it takes:

```text
/code-review please focus on the auth changes
```

Agent Desk picks up the comment (by webhook, or by polling when you have no public URL), starts a fresh Job with the repo checked out, and runs the skill. The agent posts its result back as a comment, and that comment can trigger the next skill, such as `code-build`, `code-review`, then `qa-e2e`. You can follow each run live and cancel it.

## Why Agent Desk?

- **Reuse your board.** GitHub Issues and pull requests are the queue and the audit trail. There is no new board to adopt.
- **Isolate every run.** Each run gets its own Kubernetes Job with the repo cloned as its working directory.
- **Chain agents through the ticket.** The ticket is the only handoff channel, so every step is visible and reviewable.
- **Watch and attach.** See runs as they happen, attach to the terminal, and cancel, pause or resume.
- **Configure in the UI.** Manage projects, skills and routing rules in the web app. Skills are committed to your repo.
- **Keep secrets out of the way.** Secrets are referenced by name, never stored in Postgres, and run output is redacted.

## Quick Start

You need [devbox](https://www.jetify.com/devbox) and a Docker-compatible engine (Docker Desktop or Podman). devbox provides Node 22 and pnpm 10.

```bash
git clone https://github.com/haicanhdieu/agent-desk.git
cd agent-desk
devbox run dev
```

This copies `.env.example` to `.env`, installs dependencies, then starts Postgres, Temporal, the API, the worker and the web app. No GitHub App or Kubernetes is needed locally: the stack uses a built-in fake provider and fake pods.

Open <http://localhost:5173/auth/dev-login?handle=me&redirect=/> to sign in and follow the setup flow.

```bash
devbox run stop       # stop the stack (data is kept)
devbox run db-reset   # wipe local Postgres, Temporal and fake-provider state
```

## Usage

### Run a ticket locally with the fake provider

1. In the setup flow, choose the **fake** connection and the repo `dev/demo`. Add any string as the agent credential, add the `code-review` skill, and create a rule `code-review`.
2. Create a ticket and post a comment as if it came from the provider:

```bash
curl -c cookies.txt -o /dev/null 'http://localhost:3000/auth/dev-login?handle=me&redirect=/'

curl -s -X POST http://localhost:3000/dev/fake/tickets \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"repoPath":"dev/demo","number":1,"kind":"issue","title":"Try Agent Desk"}'

curl -s -X POST http://localhost:3000/dev/fake/comments \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"repoPath":"dev/demo","ticketNumber":1,"body":"/code-review please","deliver":"webhook"}'
```

3. The run appears in the dashboard and reaches **Idle**. Attach to its terminal, type `ok`, and press Enter. Then click **Finish**.

### Use a real GitHub repository

Create a GitHub App, install it on one repo, and point Agent Desk at it. Steps: [connect-github-app-local.md](docs/runbooks/connect-github-app-local.md).

### Run the checks

```bash
devbox run check      # format check, lint, typecheck and tests
devbox run e2e-local  # end-to-end tests against the running stack
```

More options, including running without devbox: [local-dev.md](docs/runbooks/local-dev.md) and [tests-and-e2e.md](docs/runbooks/tests-and-e2e.md).

## What You Can Build

- **Ticket-to-PR pipelines:** chain build, review and QA skills so an issue ends as a merged pull request.
- **Automated code review:** run a review skill on every pull request, or only when someone asks for it.
- **Interactive agent sessions:** attach to a live run, steer the agent in its terminal, then finish or resume it later.
- **Team-wide agent rules:** route tickets to different skills and agents by slash command and label.

## How It Works

A ticket event reaches the API, which verifies it and hands it to a Temporal workflow. The router matches your rules, and the worker starts a Kubernetes Job for the run. The run's output is redacted and streamed to the dashboard and the terminal relay, and the agent's result goes back to the ticket.

### Core Primitives

| Concept      | Purpose                                                                |
| ------------ | ---------------------------------------------------------------------- |
| Project      | Top-level container. Holds one workspace, one board, agents and rules. |
| Desk         | The admin area of a project where you configure everything below.      |
| Workspace    | The code and skill base an agent is launched in (the repo).            |
| Board        | Where tickets live and where agents report (GitHub Issues and PRs).    |
| Skill        | A named, user-written procedure the agent follows.                     |
| Agent        | A CLI agent profile: provider, model, credentials and limits.          |
| Routing rule | "When a ticket matches X, run skill Y with agent Z."                   |
| Run          | One execution of one skill by one agent for one ticket (one Job).      |

The PoC supports GitHub as the board and Claude Code as the agent. Provider and agent code live behind adapters so others can be added. Details: [Architecture](<docs/Agent Desk — Architecture (PoC).md>).

### Repository layout

| Path                 | What                                                          |
| -------------------- | ------------------------------------------------------------- |
| `apps/api`           | NestJS/Fastify: HTTP, auth, webhook intake, terminal relay    |
| `apps/worker`        | Temporal workflows and activities                             |
| `apps/web`           | Vite SPA (TanStack Router/Query), design system, Storybook    |
| `packages/contracts` | Zod schemas and the route table, the API source of truth      |
| `packages/core`      | Domain logic, provider adapters, router, KubeGateway, secrets |
| `packages/db`        | Drizzle schema, migrations, per-org row-level security        |

## Documentation

| Need                     | Documentation                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Start the stack locally  | [docs/runbooks/local-dev.md](docs/runbooks/local-dev.md)                               |
| Run tests and e2e        | [docs/runbooks/tests-and-e2e.md](docs/runbooks/tests-and-e2e.md)                       |
| Use a real GitHub App    | [docs/runbooks/connect-github-app-local.md](docs/runbooks/connect-github-app-local.md) |
| All runbooks             | [docs/runbooks/](docs/runbooks/README.md)                                              |
| Code rules for each area | [docs/conventions/](docs/conventions/README.md)                                        |
| Product requirements     | [PRD](<docs/Agent Desk — PRD (PoC).md>)                                                |
| Architecture, decisions  | [Architecture](<docs/Agent Desk — Architecture (PoC).md>) and [ADRs](docs/adr/)        |

## Development

```bash
devbox run dev        # start the stack
devbox run fix        # prettier + eslint --fix on changed files
devbox run check      # format check, lint, typecheck and tests
pnpm test:unit:coverage  # unit coverage report per package
```

Read [AGENTS.md](AGENTS.md) and the [conventions](docs/conventions/README.md) before sending a change. Commits use Conventional Commits with the package as scope, and PRs stay small and focused.

To report a vulnerability or a leaked secret, do not open a public issue. Use GitHub's private vulnerability reporting on this repository.

## License

Licensed under the [Apache License 2.0](LICENSE). If you redistribute this project or a modified version, you must keep the copyright notice, include the [NOTICE](NOTICE) file, and state your changes.
