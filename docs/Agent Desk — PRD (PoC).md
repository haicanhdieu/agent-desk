# Agent Desk — PRD (PoC)

Nov 11, 2026 · @Minh Nguyen

## 1. Summary

Agent Desk is a web system that lets a user delegate work to AI coding agents through an ordinary ticket board. The user writes a ticket; an agent picks it up, runs a user-defined skill in an isolated container, writes the result back to the ticket, and hands off to the next agent.

The PoC proves one loop end to end: a GitHub issue goes from "written" to "merged PR" through two or more chained skills, with every agent run visible live in a web dashboard.

**Problem.** Running CLI agents (Claude Code, Codex, Cursor) today means a developer opens a terminal, checks out a repo, and babysits one session. There is no shared queue, no handoff between agents, and no place to watch several runs at once.

**Approach.** Reuse the board the team already has as the queue and the audit trail. Agent Desk adds only what is missing: routing rules, on-demand agent containers, and a live view.

## 2. Goals and non-goals

**Goals (PoC)**

- G1. A ticket event on GitHub starts the right agent with the right skill, with no manual step. This works with a webhook or, where no public URL is available, by polling.
- G2. Each run executes in a fresh Kubernetes container with the project repo checked out as its working directory.
- G3. Agents chain through the ticket itself: one run's comment triggers the next run.
- G4. The user sees every run live in a web dashboard and can cancel it.
- G5. The user manages projects, skills, and routing rules from a web UI. Skills are saved to the repo.

**Non-goals (PoC)**

- Other boards (Jira, Trello, local file board) and other agents (Codex, Cursor). The design leaves an adapter seam for both; the PoC implements GitHub and Claude Code only.
- MCP tool connections.
- Multi-tenant SaaS concerns: billing, organizations, roles, quotas.
- Natural-language onboarding and desk configuration.
- A Kanban UI of our own. GitHub Issues and Projects remain the board UI.

## 3. Core concepts

The initial idea used "desk" for a team of agents. This spec narrows the vocabulary to seven terms; "Desk" becomes the configuration area of a project.

| Concept      | Definition                                                                              | PoC implementation                                     |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Project      | Top-level container owned by a user. Holds one workspace, one board, agents, and rules. | One project = one GitHub repo                          |
| Desk         | The admin area of a project where the user configures everything below.                 | Web UI pages                                           |
| Workspace    | The code, document, and skill base an agent is launched in.                             | The GitHub repo, cloned per run                        |
| Board        | Where tickets live and where agents report.                                             | GitHub Issues and pull requests of the same repo       |
| Skill        | A named, user-written procedure an agent follows.                                       | `.claude/skills/<name>/SKILL.md` in the repo           |
| Agent        | A CLI agent profile: provider, model, credentials, limits.                              | Claude Code only                                       |
| Routing rule | "When a ticket matches X, run skill Y with agent Z."                                    | Slash command in a comment, plus optional label filter |
| Run          | One execution of one skill by one agent for one ticket.                                 | One Kubernetes Job                                     |

Two rules follow from this model:

- A project does not own its board exclusively. Rules select tickets; several rules, and later several projects, can consume the same board.
- The ticket is the only handoff channel. Agents do not talk to each other directly; they read and write the ticket.

## 4. Primary user journey

Persona: a solo developer or tech lead who already uses GitHub Issues and Claude Code.

**Setup (once per project)**

1. Sign in with GitHub.
2. Create a project `agent-desk` and install the Agent Desk GitHub App on one repo. Choose how Agent Desk learns of new comments: Webhook (default, near-instant) or Polling (works with no public URL).
3. Add the Claude credential (API key or Claude Code OAuth token) for the project's agent.
4. Define skills in the web editor: `code-build`, `code-review`, `code-e2e`, `qa-e2e`. Each save commits a `SKILL.md` to the repo.
5. Add routing rules, for example: label `user-story` + comment `/code-build` → agent Claude, skill `code-build`.

**Daily use**

1. The developer creates an issue "Implement feature A" with full detail, label `user-story`, and comments `/code-build`.
2. Agent Desk receives the event (by webhook, or on its next poll), matches the rule, and starts a run. The issue gets a comment with a link to the live run.
3. The agent reads the issue, writes code, opens a PR linked to the issue, and comments `/code-review` on the PR.
4. That comment matches the next rule. A second run starts with skill `code-review`: it reviews, fixes, and merges or requests changes.
5. The developer watches both runs in the dashboard, cancels one if it goes wrong, and can steer by adding a comment and re-issuing a command.

**Setup without a public URL**

Persona: the same developer, running Agent Desk on a laptop or inside a locked-down network where GitHub cannot deliver webhooks.

1. In setup step 2 the developer picks Polling and an interval (5, 10, 15, or 30 min; default 5 min). Setup does not wait for a webhook ping.
2. The connect step shows success as soon as the first poll succeeds, for example "Polling every 5 min · last checked 20s ago".
3. Daily use is the same as above. A run starts up to one interval (5 minutes at the default) later than it would with a webhook, and each handoff in a chain can add up to one more interval.
4. If webhooks were chosen but none arrive, the project shows a warning with a "Switch to polling" action. The mode can be changed later in project settings.

## 5. Functional requirements

P0 is required for the PoC demo. P1 is built only if time allows.

| ID                    | Requirement                                                                                                                                                                                                                                                                                                   | Priority |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Projects and desk** |                                                                                                                                                                                                                                                                                                               |          |
| FR-1                  | Sign in with GitHub; a user sees only their own projects.                                                                                                                                                                                                                                                     | P0       |
| FR-2                  | Create, list, update, delete projects. A project binds to one repo through a GitHub App installation.                                                                                                                                                                                                         | P0       |
| FR-3                  | Store one agent credential per project as a secret; never display it after save.                                                                                                                                                                                                                              | P0       |
| FR-4                  | Set a per-project limit on concurrent runs (default 2).                                                                                                                                                                                                                                                       | P0       |
| **Triggers**          |                                                                                                                                                                                                                                                                                                               |          |
| FR-22                 | Each project has a trigger mode: Webhook (default) or Polling. The user picks it during setup and can change it later in project settings.                                                                                                                                                                    | P0       |
| FR-23                 | In Polling mode, Agent Desk checks the repo for new issue and PR comments on an interval of 5, 10, 15, or 30 min (default and minimum 5 min). No public URL or webhook relay is needed.                                                                                                                       | P0       |
| FR-24                 | Polled comments go through the same rules, authorization, and guards as webhook comments. A comment starts at most one run, even if it is seen by both webhook and polling (for example right after a mode switch).                                                                                           | P0       |
| FR-25                 | The project shows its connection status: "Polling every 5 min" or "Last event: X (webhook)" when healthy, "No webhooks for 2 days" with a "Switch to polling" action when webhooks go silent, and "Polling failed: reason" (for example token revoked, or rate limited with a retry time) when polling fails. | P0       |
| **Skills**            |                                                                                                                                                                                                                                                                                                               |          |
| FR-5                  | List skills found in the repo under `.claude/skills/`.                                                                                                                                                                                                                                                        | P0       |
| FR-6                  | Create, edit, delete a skill in a web Markdown editor; each save is a commit to the default branch.                                                                                                                                                                                                           | P0       |
| FR-7                  | Starter templates for `code-build` and `code-review`.                                                                                                                                                                                                                                                         | P1       |
| **Routing rules**     |                                                                                                                                                                                                                                                                                                               |          |
| FR-8                  | CRUD rules with: slash command, optional label filter, target (issue, PR, or both), agent, skill.                                                                                                                                                                                                             | P0       |
| FR-9                  | Only commands from users with write access to the repo, or from the Agent Desk bot, start a run.                                                                                                                                                                                                              | P0       |
| FR-10                 | Chain guard: at most N runs per ticket (default 10), and one active run per ticket and skill.                                                                                                                                                                                                                 | P0       |
| FR-11                 | Trigger on label-added events without a command.                                                                                                                                                                                                                                                              | P1       |
| **Runs**              |                                                                                                                                                                                                                                                                                                               |          |
| FR-12                 | A matching event creates a run in a new container with the repo cloned at the right ref (default branch for issues, PR head for PRs).                                                                                                                                                                         | P0       |
| FR-13                 | The agent can read and write issues, comments, labels, branches, and PRs on that repo only.                                                                                                                                                                                                                   | P0       |
| FR-14                 | Agent Desk posts a start comment with the run link and a finish comment with status and duration.                                                                                                                                                                                                             | P0       |
| FR-15                 | Runs stop at a timeout (default 30 min) and are marked `timed_out`.                                                                                                                                                                                                                                           | P0       |
| FR-16                 | Manual "Run skill on ticket" and "Retry" from the web UI.                                                                                                                                                                                                                                                     | P1       |
| **Dashboard**         |                                                                                                                                                                                                                                                                                                               |          |
| FR-17                 | List runs per project with status, ticket, skill, agent, start time, duration.                                                                                                                                                                                                                                | P0       |
| FR-18                 | Run detail page streams the agent's messages and tool calls live, and replays them after the run ends.                                                                                                                                                                                                        | P0       |
| FR-19                 | Cancel a running run.                                                                                                                                                                                                                                                                                         | P0       |
| FR-20                 | Send a follow-up message to a running agent from the web.                                                                                                                                                                                                                                                     | P1       |
| FR-21                 | Show token usage and cost per run, when the CLI reports it.                                                                                                                                                                                                                                                   | P1       |

## 6. Scope

| Area      | In the PoC                                                                                | Deferred                                                                            |
| --------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Board     | GitHub Issues and PRs of one repo per project                                             | Jira, Trello, local file board, GitHub Projects column moves                        |
| Agent     | Claude Code CLI, headless                                                                 | Codex, Cursor, mixed-agent chains                                                   |
| Trigger   | Slash command in a comment, label filter; delivered by webhook or by polling, per project | Label-only, assignee, ticket type, schedules; polling of events other than comments |
| Workspace | One GitHub repo, cloned fresh per run                                                     | Multiple repos, file storage, persistent workspaces                                 |
| Skills    | Stored in the repo, edited in web UI                                                      | Skill library shared across projects, versioning UI                                 |
| Tools     | Git, `gh` CLI, whatever the runner image ships                                            | MCP servers                                                                         |
| Runtime   | Kubernetes Jobs on a local cluster; image built with Podman or Docker                     | Autoscaling, multi-cluster, warm pools                                              |
| Dashboard | Live read-only stream, cancel, history                                                    | Full remote terminal, takeover, multi-run grid                                      |
| Users     | Single user per project, GitHub sign-in                                                   | Teams, roles, organizations                                                         |

Non-functional targets for the PoC, chosen to be checkable rather than ambitious:

- A run starts (container running, first stream event visible) within 60 seconds of the triggering comment on a warm node in Webhook mode. In Polling mode the budget is 60 seconds plus up to one polling interval, so up to about 6 minutes at the default 5 min.
- Polling uses little of GitHub's API limit: one request per repo per interval (12 per hour per repo at 5 min), and an unchanged result costs no rate limit.
- Stream latency from agent to browser is under 3 seconds.
- Credentials never appear in logs, stream events, or ticket comments.
- A crashed control plane loses no runs: on restart it reconciles run state from Kubernetes.

## 7. Success criteria

The PoC succeeds when this demo runs unattended, three times in a row, on a sample repo:

1. Create an issue with label `user-story` and comment `/code-build`.
2. A run appears in the dashboard and streams live.
3. A PR is opened, linked to the issue, with a `/code-review` comment from the bot.
4. A second run starts on the PR, reviews it, and merges it or leaves change requests.
5. Both runs show a final status, and the issue carries start and finish comments for each.

Acceptance checks beyond the happy path:

- A `/code-build` comment from a user without write access starts nothing.
- A skill that comments its own command repeatedly is stopped by the chain guard.
- Cancel from the dashboard ends the container within 30 seconds and marks the run `cancelled`.
- A third matching event while two runs are active is queued, then starts when a slot frees.
- With the project in Polling mode and no webhook configured, the same demo completes, with each run starting within one interval plus 60 seconds of its comment.
- Switching a project from Webhook to Polling (or back) while comments arrive starts each run exactly once.
- Revoking the App installation shows "Polling failed: token revoked" on the project and starts nothing.

## 8. Risks, open questions, milestones

**Risks**

| Risk                                                              | Impact                                                              | Mitigation in the PoC                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection through ticket text                              | Agent performs unintended actions with repo write access            | Write-access check on triggers, token scoped to one repo, no other secrets in the container, restricted network egress                                                                                                                                                  |
| Runaway chains or cost                                            | Agents trigger each other without end                               | Chain guard, timeout, concurrency limit, per-run turn limit                                                                                                                                                                                                             |
| Handoff depends on the model remembering to post the next command | Chain stalls silently                                               | Finish comment always posted by the system; open question Q1                                                                                                                                                                                                            |
| Agent merges bad code                                             | Broken default branch                                               | Branch protection on the sample repo; `code-review` may be configured to approve only                                                                                                                                                                                   |
| Webhooks cannot reach a local cluster or a locked-down network    | No triggers without a public URL                                    | Polling mode, which needs only outbound calls to GitHub; it is also the recommended path for local development                                                                                                                                                          |
| Polling is slower                                                 | Runs and chain handoffs start up to one interval (5 to 30 min) late | Default to the 5 min minimum; use Webhook mode where latency matters. API budget is not a concern: at most 12 requests per hour per repo against 5000 per installation, unchanged results cost nothing, and a rate-limit response still backs off with a visible status |

**Open questions**

- Q1. Should the handoff be written by the skill (the agent posts `/code-review`) or declared on the rule ("on success, post `/code-review`")? The PoC assumes the skill posts it, as in the original idea; a rule-level `onSuccess` is more reliable and cheap to add.
- Q2. Should routing rules live in the database or in the repo next to the skills (`.agentdesk/rules.yaml`)? The PoC assumes the database.
- Q3. Which Claude credential type will be used: API key or subscription OAuth token? It affects cost reporting and rate limits.
- Q4. Is merge by an agent acceptable in the demo, or should a human always merge?
- Q5. Should Webhook projects also run a slow background poll (for example every 30 minutes) to catch missed deliveries? The PoC polls only projects in Polling mode; comment-id dedupe already makes running both safe.

**Milestones**

1. M1 — Runner: a container image that clones a repo and runs one skill headless, started by hand with `kubectl`.
2. M2 — Trigger: GitHub App, webhook intake and polling intake, rule matching, Job creation, start and finish comments.
3. M3 — Dashboard: run list, live stream, cancel.
4. M4 — Desk: project setup, skill editor, rule CRUD.
5. M5 — Chain and hardening: two-skill chain, guards, queueing, the demo script in section 7.
