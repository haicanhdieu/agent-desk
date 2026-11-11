# Agent Desk — Architecture (PoC)

Nov 11, 2026 · @Minh Nguyen

## 1. Overview and principles

Agent Desk for the PoC is one control-plane service, one Postgres database, and one short-lived Kubernetes Job per agent run. GitHub is both the trigger source and the place agents write results; the control plane only routes, launches, and observes.

This document is the companion to the Agent Desk PRD (PoC) and uses its vocabulary: project, workspace, board, skill, agent, routing rule, run.

Five principles keep the PoC small:

- **The ticket is the bus.** Agents never call each other. A run ends by writing to the ticket; the next run starts from a ticket event.
- **Runs are cattle.** Every run gets a new container, a fresh clone, and short-lived credentials. Nothing survives the run except what was pushed to GitHub and the stored run log.
- **Skills live with the code.** A skill is a file in the repo, so the agent sees it natively and changes are reviewed like code.
- **Deterministic outside, agentic inside.** Routing, guards, status comments, and timeouts are plain code. Only the skill execution is left to the model.
- **Seams, not abstractions.** Two interfaces exist from day one, `BoardAdapter` and `AgentRunner`, each with a single implementation (GitHub, Claude Code). Nothing else is generalized.

## 2. Components

&#91;embedded content: system components · control plane, run Job, GitHub\]

GitHub events enter through the webhook intake, the router turns a matching comment into a queued run, and the run controller starts one Job per run. The Job is the only component that touches the repo; it also calls the Claude API directly. The control plane never executes agent code. The browser reaches a run's terminal through the control plane, which relays it to the pod over a Kubernetes exec WebSocket.

## 3. Domain model and data schema

Seven tables hold all state. Skills are not stored; they are read from and written to the repo through the GitHub API.

| Table | Key columns | Notes |
| --- | --- | --- |
| `users` | id, github\_user\_id, login | Created at first GitHub sign-in |
| `projects` | id, owner\_user\_id, name, repo\_full\_name, installation\_id, max\_concurrent\_runs, max\_runs\_per\_ticket | One repo per project in the PoC |
| `agents` | id, project\_id, name, provider (`claude`), model, credential\_secret\_name, max\_turns, timeout\_seconds | Credential value lives in a Kubernetes Secret, not in Postgres |
| `rules` | id, project\_id, command, label\_filter\[\], target (`issue`, `pr`, `any`), agent\_id, skill\_name, enabled | Unique on (project\_id, command) |
| `runs` | id, project\_id, rule\_id, agent\_id, skill\_name, ticket\_number, ticket\_kind, ref, args, status, job\_name, trigger\_delivery\_id, triggered\_by, queued\_at, started\_at, finished\_at, exit\_code, cost\_usd | Also the work queue |
| `run_events` | run\_id, seq, ts, type, payload (jsonb) | PoC: lifecycle lines (turn finished, final scrollback). MVP: one row per agent event |
| `webhook_deliveries` | delivery\_id, received\_at, event, action, outcome | Dedupe and debugging |

Run status moves forward with one loop: `queued` → `starting` → `running` ⇄ `idle` → one of `succeeded`, `failed`, `cancelled`, `timed_out`. `idle` means the agent finished a turn and waits for the user (section 6).

The two seams, in pseudo-signature form:

```
BoardAdapter
  ParseEvent(headers, body)      -> TicketEvent | null
  GetTicket(project, number)     -> Ticket
  Comment(project, number, text)
  MintWorkspaceToken(project)    -> short-lived token

AgentRunner
  BuildJobSpec(run, agent, token) -> Kubernetes Job
  ParseEvent(logLine)             -> RunEvent
```

## 4. Trigger and routing

A run is created only when a webhook passes every step below; any failed step ends processing with a recorded outcome and no side effect.

1. **Receive.** `POST /webhooks/github`. Verify the `X-Hub-Signature-256` HMAC against the App's webhook secret. Reject on mismatch.
2. **Dedupe.** Insert `X-GitHub-Delivery` into `webhook_deliveries`; a duplicate key means the delivery was already handled.
3. **Filter event.** The PoC handles `issue_comment` with action `created`. GitHub sends this event for comments on both issues and pull requests.
4. **Resolve project.** Look up the project by `installation.id` and repository name.
5. **Parse command.** The first line of the comment must match `^/([a-z0-9-]+)(\s+.*)?$`. The capture is the command; the rest of the line is passed to the agent as arguments.
6. **Authorize.** Accept if the author is the Agent Desk bot, or `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`.
7. **Match rule.** Find the enabled rule for (project, command). Check the target kind and that the ticket carries every label in `label_filter`.
8. **Guard.** Reject if the ticket already has `max_runs_per_ticket` runs, or an active run for the same skill.
9. **Enqueue.** Insert a `runs` row with status `queued`. Reply to the webhook with 202.

A run controller loop then claims queued runs with `SELECT … FOR UPDATE SKIP LOCKED` while the project is under `max_concurrent_runs`. Postgres is the queue; no broker is needed at this scale.

**Chaining.** A run posts its handoff comment (for example `/code-review` on the PR it opened) with the App installation token, so the comment is authored by the bot. GitHub delivers webhooks for App-authored comments, the bot passes step 6, and the next rule fires. This behavior is the basis of the whole chain and should be confirmed first in milestone M2.

**Local development.** A local cluster has no public URL. Use a webhook relay (smee.io or a tunnel) to forward deliveries. A polling fallback that lists recent issue comments every 30 seconds can reuse steps 5 to 9 unchanged.

## 5. Run lifecycle on Kubernetes

Each run is one Kubernetes Job with one pod and one container; the container is the agent's sandbox, so Claude Code runs interactively in a tmux session with permission prompts disabled.

**Lifecycle**

1. The controller claims a queued run and sets it to `starting`.
2. It mints a GitHub installation token scoped to the project's repo. The token expires after one hour, which bounds the run timeout.
3. It creates a per-run Secret (GitHub token, Claude credential) and a Job that references it. The Secret is owned by the Job, so both are garbage-collected together.
4. It posts the start comment on the ticket with a link to the run page.
5. The pod starts. The entrypoint clones the repo, checks out the ref, and starts Claude Code interactively in a detached tmux session named agent.
6. The controller follows the pod log, stores lifecycle lines as run events, and sets the run to `running` at the first log line.
7. When the agent finishes a turn, a Stop hook writes a log line and the controller sets the run to `idle`. The run ends on the user's Finish click or after the idle timeout (section 6).
8. When the session ends and the Job completes, the controller records the exit status, posts the finish comment, and frees the concurrency slot.

**Runner image**

One image, built with Podman or Docker: a slim Node base, `git`, `gh`, tmux, the Claude Code CLI, and common build toolchains for the sample repo. Project-specific toolchains are a later concern; the PoC bakes in what the demo repo needs. The image's user-level Claude Code settings hold the Stop hook described in section 6.

Entrypoint, simplified (exact flags are to be confirmed in M1):

```bash
set -euo pipefail
git clone "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git" /workspace
cd /workspace
if [ "${TICKET_KIND}" = "pr" ]; then gh pr checkout "${TICKET_NUMBER}"; fi
git config user.name  "agent-desk[bot]"
git config user.email "${BOT_EMAIL}"

# Interactive Claude Code in a detached tmux session. The container is the
# sandbox, so the permission mode is bypass, set explicitly.
tmux new-session -d -s agent -x 200 -y 50 \
  'claude --permission-mode bypassPermissions "$PROMPT"' \; set-option remain-on-exit on
echo "agentdesk: session started"

# Wait until the agent process has exited (Finish, idle timeout, or the agent quits).
while [ "$(tmux display-message -p -t agent '#{pane_dead}')" = "0" ]; do sleep 2; done

# Final scrollback to stdout, then exit with the agent's status.
echo "agentdesk: final scrollback begin"
tmux capture-pane -p -S - -t agent
echo "agentdesk: final scrollback end"
STATUS="$(tmux display-message -p -t agent '#{pane_dead_status}')"
tmux kill-session -t agent
exit "${STATUS}"
```

The prompt is built by the control plane from a fixed template:

```
Use the skill "{skill_name}" on {ticket_kind} #{ticket_number} in {repo}.
Read the ticket and all its comments with the gh CLI before you start.
Arguments from the user: {args}
When done, report on the ticket as the skill instructs.
```

Because skills sit in `.claude/skills/` of the cloned repo, Claude Code discovers them without extra configuration. CLI flag names should be checked against the installed CLI version during M1. An interactive session has no turn limit, so the hard timeout and the idle timeout bound a run, and MAX\_TURNS in the Job spec is unused in the PoC.

**Job spec, essentials**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: run-{{runId}}
  namespace: agentdesk-runs
  labels: { agentdesk/run-id: "{{runId}}", agentdesk/project-id: "{{projectId}}" }
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 1800
  ttlSecondsAfterFinished: 3600
  template:
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext: { runAsNonRoot: true, runAsUser: 1000 }
      containers:
        - name: agent
          image: agentdesk/runner-claude:poc
          envFrom: [{ secretRef: { name: run-{{runId}} } }]
          env:
            - { name: REPO, value: "{{owner/repo}}" }
            - { name: TICKET_KIND, value: "{{issue|pr}}" }
            - { name: TICKET_NUMBER, value: "{{number}}" }
            - { name: PROMPT, value: "{{prompt}}" }
            - { name: MAX_TURNS, value: "{{maxTurns}}" }
          resources:
            requests: { cpu: 500m, memory: 1Gi }
            limits:   { cpu: "2",  memory: 4Gi }
```

**Failure handling**

| Situation | Detection | Result |
| --- | --- | --- |
| Agent exits non-zero | Job condition `Failed` | Run `failed`; finish comment includes the tail of the final scrollback |
| Timeout | `DeadlineExceeded` | Run `timed_out` |
| User cancels | API call deletes the Job with foreground propagation | Run `cancelled` |
| Image pull or scheduling error | Pod stuck `Pending` for over 2 minutes | Run `failed` with the pod event message |
| Idle timeout | Run idle with no terminal attached for 10 minutes (default) | Controller ends the tmux session, the Job completes, run succeeded |
| Control plane restarts | On startup, list Jobs by label and compare with `runs` | Status reconciled; log following resumes |

## 6. Live streaming and interaction

The PoC shows the real Claude Code terminal in the browser; the MVP makes a structured, chat-style stream the default view and keeps the terminal as an "open terminal" view on the same run.

**PoC: terminal in the browser (approach A)**

Approach A is the quickest to build and gives exactly the CLI experience.

- **In the pod.** The runner entrypoint clones the repo, then starts a detached tmux session named `agent` that runs Claude Code interactively (not `-p` headless) with the initial prompt as its argument. The permission mode is set explicitly on the command line: bypass permissions, because the container is the sandbox. The entrypoint then waits for the tmux session to end and exits with the recorded exit status. tmux is what lets a browser disconnect and reconnect without killing the session.
- **In the browser.** `@xterm/xterm` with `@xterm/addon-fit` in the React run-detail page.
- **Transport.** The browser holds a WebSocket to the control plane (`GET /api/runs/{id}/terminal`). The control plane opens a Kubernetes `pods/exec` WebSocket (subprotocol `v5.channel.k8s.io`, `tty=true`, `stdin=true`) that runs `tmux attach -t agent`, and relays bytes both ways. Terminal resize goes over the exec resize channel. The runner still needs no network path back to the control plane.
- **Authorization.** Only the project owner may open the terminal for a run. The control plane, not the browser, holds the Kubernetes credentials.

**Run completion and idle**

An interactive session does not exit when the agent finishes a turn, so the run needs an explicit end. A Claude Code `Stop` hook, configured in the image's user-level settings (not in the repo), writes a "turn finished" line to the container's stdout. The control plane sees it in the pod log and sets the run to `idle`, which means it waits for the user.

The run ends when the user clicks "Finish" in the dashboard (`POST /api/runs/{id}/finish`), or when it has been idle with no terminal attached for an idle timeout (default 10 minutes). The controller then ends the tmux session, the Job completes, and the run becomes `succeeded`. The existing hard timeout and cancel still apply. Chaining is unaffected because the skill posts its handoff comment during the turn.

**History**

At the end of a run the runner prints the full tmux scrollback (`tmux capture-pane -p -S -`) to stdout, and the control plane stores it as the run's final log for later viewing. Live terminal bytes are not stored in the PoC. So `run_events` holds lifecycle lines (turn finished, final scrollback), not a structured event per agent message. A cancelled or timed-out run kills the pod and may leave no final scrollback.

**Redaction.** Before storage, replace any occurrence of the run's GitHub token and Claude credential with a placeholder. This is a backstop; the main protection is that the agent has no reason to print them.

**Cancel (P0).** The API deletes the Job. The pod receives SIGTERM, the log stream ends, and the run is marked `cancelled`.

**Steering through the ticket (P0, free).** The user comments on the ticket and issues the command again. The new run reads the full comment history. This fits the model and needs no extra code.

**MVP: structured stream plus terminal (approach B, not in the PoC)**

In the MVP, approach B becomes the default view and the terminal from A stays available as an "open terminal" view on the same run.

- **In-pod runner.** A small Node/TypeScript process uses the official `@anthropic-ai/claude-agent-sdk` in streaming-input mode: follow-up messages, `interrupt()`, and `canUseTool` permission callbacks.
- **Transport.** The runner opens an outbound WebSocket to the control plane with a per-run token. Every event gets a sequence number.
- **Control plane.** It stores each event in `run_events` (jsonb), fans out to browsers, and replays from the database on reconnect using the last sequence number. Pending permission requests are kept in the database.
- **Frontend.** `@assistant-ui/react` or a custom transcript renderer: messages, tool calls, diffs, and permission cards.
- **Why both.** B gives searchable history, structured permission prompts, and a mobile-friendly view. A gives exact CLI fidelity for power users.

| Aspect | A: terminal (PoC) | B: structured stream (MVP default) |
| --- | --- | --- |
| Fidelity | Exact CLI experience | Chat-style rendering of SDK events |
| Build effort | Lowest: tmux, xterm.js, an exec relay | Higher: Node runner, event protocol, replay, renderer |
| History and search | Final scrollback only, plain text | Every event stored as jsonb, searchable |
| Permission prompts | Bypassed in the PoC; answered in the terminal if enabled | Structured cards through `canUseTool`, kept in the database |
| Reconnect | tmux keeps the session; the screen redraws | Replay from the database by last sequence number |
| Mobile | A terminal on a small screen | Mobile-friendly view |
| Security | `pods/exec` is shell-equivalent; per-run owner check; runner needs no path back | Outbound WebSocket with a per-run token; runner needs a path to the control plane |

## 7. GitHub integration, secrets, and security

One GitHub App provides sign-in, webhooks, and repo access; the agent container holds only a one-hour token for one repo plus the Claude credential.

**GitHub App**

| Setting | Value |
| --- | --- |
| Repository permissions | Contents: read/write · Issues: read/write · Pull requests: read/write · Metadata: read |
| Webhook events | Issue comment (PoC) · Issues, Pull request (later) |
| User sign-in | The App's OAuth flow; session cookie on the web UI |
| Skill editing | Contents API, commits to the default branch as the bot |

**Secrets**

| Secret | Stored in | Reaches the run container |
| --- | --- | --- |
| App private key, webhook secret | Kubernetes Secret in the control-plane namespace | No |
| Claude credential per project | Kubernetes Secret in the control-plane namespace, referenced by name from `agents` | Yes, copied into the per-run Secret |
| Installation token | Minted per run, never persisted | Yes |

**Threat model for the PoC**

The main risk is prompt injection: ticket text is untrusted input to an agent that can push code. Controls, in order of importance:

- Only repo collaborators and the bot can trigger runs (section 4, step 6).
- The installation token is limited to the project's single repo and expires in one hour.
- The run pod mounts no service account token and cannot reach the Kubernetes API.
- A NetworkPolicy on the runs namespace denies egress to cluster-internal addresses and allows the public internet. Domain allowlisting needs a CNI with FQDN policies and is deferred.
- Containers run as non-root with CPU, memory, and time limits.
- Branch protection on the default branch remains the last line of defense against a bad merge.
- Terminal access is shell-equivalent. The control plane service account holds `pods/exec` in the runs namespace, so it opens a terminal only for the project owner of that run and never gives Kubernetes credentials to the browser.
- Repo content can run code in the container. Project-level `.claude/settings.json` hooks and `.mcp.json` servers in the cloned repo execute inside the run container. This is acceptable only because the container is the sandbox and holds a single-repo token.
- The permission mode is always set explicitly. Recent CLI versions start headless runs in manual permission mode by default, so the entrypoint passes the mode on the command line.

Known gap: the Claude credential is readable by the agent process, so a successful injection could exfiltrate it. Mitigation for the PoC is a dedicated low-limit key; the later fix is an egress proxy that injects the credential outside the container.

## 8. API, tech stack, deployment

The control plane is a single deployable (a modular monolith) that serves the web UI, the REST API, the webhook endpoint, and the background loops.

**API surface**

| Method and path | Purpose |
| --- | --- |
| `GET /auth/github`, `GET /auth/github/callback` | Sign-in |
| `POST /webhooks/github` | Webhook intake |
| `GET, POST /api/projects` · `GET, PATCH, DELETE /api/projects/{id}` | Project CRUD |
| `PUT /api/projects/{id}/agent` | Set model, limits, and credential |
| `GET /api/projects/{id}/skills` · `GET, PUT, DELETE /api/projects/{id}/skills/{name}` | Skills, proxied to the repo |
| `GET, POST /api/projects/{id}/rules` · `PATCH, DELETE /api/rules/{id}` | Rule CRUD |
| `GET /api/projects/{id}/runs` · `GET /api/runs/{id}` | Run list and detail |
| `GET /api/runs/{id}/events?after={seq}` | Run status and lifecycle updates (SSE) |
| `POST /api/runs/{id}/cancel` | Cancel |
| `GET /api/runs/{id}/terminal` | Terminal WebSocket, project owner only |
| `POST /api/runs/{id}/finish` | Finish an idle run |
| `POST /api/projects/{id}/runs` | Manual run (P1) |

**Modules inside the service**

| Module | Responsibility |
| --- | --- |
| Webhook intake | Verify, dedupe, parse into a `TicketEvent` |
| Router | Authorize, match rules, apply guards, enqueue |
| Run controller | Claim queued runs, create Jobs, watch status, end idle runs, reconcile |
| Terminal relay and log follower | Relay the terminal WebSocket to pod exec; follow pod logs, store lifecycle lines and the final log, push status over SSE |
| GitHub adapter | App auth, tokens, comments, contents API |
| Desk API | Projects, agents, rules, skills |

**Suggested stack**

| Layer | Choice | Why |
| --- | --- | --- |
| Control plane | ASP.NET Core (.NET), with the official Kubernetes client and Octokit | Hosted background services fit the controller loops; TypeScript with Fastify is an equal alternative |
| Database | Postgres | Config, queue, and event log in one place |
| Web UI | React single-page app served by the control plane | Three screens: desk, run list, run detail |
| Cluster | kind or k3d locally | Both run on Docker; kind also supports Podman |
| Runner image | Built with Podman or Docker, loaded into the local cluster; includes tmux | No registry needed for the PoC |
| Packaging | Plain Kubernetes manifests with Kustomize | Helm is unnecessary at this size |
| Terminal | @xterm/xterm with @xterm/addon-fit in the React app | Shows the real Claude Code UI from the tmux session |

**Deployment layout**

- Namespace `agentdesk`: control-plane Deployment (1 replica), Postgres StatefulSet, Service, Secrets.
- Namespace `agentdesk-runs`: Jobs, per-run Secrets, NetworkPolicy.
- RBAC: the control-plane service account may manage `jobs`, `pods`, `pods/log`, `pods/exec`, and `secrets` in `agentdesk-runs` only.
- During development the control plane can run on the host against the cluster's kubeconfig.

## 9. Key decisions and evolution

| Decision | PoC choice | Alternative set aside | Revisit when |
| --- | --- | --- | --- |
| Trigger mechanism | GitHub App webhooks | Polling, GitHub Actions as the runner | Never for webhooks; polling stays as a dev fallback |
| Handoff | Slash-command comment written by the skill | `onSuccess` action declared on the rule | Chains stall because the model forgets the comment |
| Rule storage | Postgres | YAML in the repo | Users want rules reviewed and versioned with skills |
| Queue | Postgres table with `SKIP LOCKED` | NATS, Temporal | Multiple control-plane replicas or long multi-step workflows |
| Run isolation | One Job per run, fresh clone | Long-lived agent pods, persistent volumes | Clone and dependency install dominate run time |
| Streaming | Terminal via tmux, pods/exec, and xterm.js | Structured stream only | The MVP adds the structured stream (approach B) as the default view |
| Agent abstraction | `AgentRunner` interface, Claude only | Generic CLI plugin system | Adding Codex: new image, new log parser, same Job flow |
| Board abstraction | `BoardAdapter` interface, GitHub only | Unified ticket model up front | Adding Jira: tickets and code live in different systems, so workspace and board must be configured separately |

**After the PoC, in likely order**

1. The structured event stream (approach B) as the default dashboard view, with the terminal kept as an "open terminal" view.
2. Second agent (Codex) to prove the `AgentRunner` seam and mixed-agent chains.
3. Rule-level `onSuccess` and `onFailure` actions, and label-based triggers.
4. MCP configuration per project, injected into the run container.
5. Per-project runner images or a setup script, with dependency caching.
6. Second board adapter and a local file board.
7. Natural-language desk configuration as a skill that calls the Desk API.

**Open technical checks for M1 and M2**

- Confirm that comments posted with an installation token deliver `issue_comment` webhooks to the same App.
- Confirm the exact interactive invocation that makes Claude Code apply a repo skill by name.
- Measure cold start: image pull, clone, and first event, against the 60-second target in the PRD.
- Find how to suppress Claude Code first-run dialogs (trust, theme) in a container.
- Test TUI rendering and flicker under tmux in xterm.js. The fullscreen renderer uses the alternate screen buffer; `CLAUDE_CODE_NO_FLICKER=1` is the documented switch to test.
- Confirm the exact exec resize channel number. The .NET Kubernetes client has no resize helper, so the resize message is written by hand.
- Confirm that the Stop hook reliably fires in interactive mode.
