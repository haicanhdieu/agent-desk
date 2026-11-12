# 0015. Live run updates over SSE fed by Postgres NOTIFY

- Status: Accepted
- Date: 2026-11-12
- Source: Architecture (PoC) §8 API (SSE for run events); control plane design §6.2, §7.4; frontend design §2 (Run events), §5.1, §5.2, §11; infra design §6.4, §9.3

## Context

The dashboard must show run status changes live (runs list, needs-you count,
run detail) with under 3 s latency (PRD), and survive dropped connections. The
api scales horizontally ([0002](0002-nestjs-on-fastify-backend.md)), and run
status is written only by the `setRunStatus` activity in the worker
([0009](0009-temporal-for-durable-work.md)). Traffic in QA passes Cloudflare,
which closes idle connections after about 100 s.

## Decision

- Two Server-Sent Events streams: `GET /api/runs/{id}/events?after={seq}`
  (status plus `run_events` backlog, then live) and
  `GET /api/projects/{id}/events` (`{ runId, number, status, seq }` per change).
- Each event's `id` is its `seq`; `Last-Event-ID` is treated as `after`, so the
  browser's automatic reconnect resumes without gaps.
- `setRunStatus` runs `pg_notify('run_status', (orgId, runId, seq))` in the
  same transaction. Each api replica holds one `LISTEN run_status` connection
  and re-reads under `withOrg`, never trusting the payload.
- Heartbeat comment every 15 s.
- The web uses native `EventSource` and patches TanStack Query caches.

## Alternatives considered

| Alternative                     | Why rejected                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `@microsoft/fetch-event-source` | Same-origin cookie means no custom headers are needed; native `EventSource` gives `Last-Event-ID` resume |
| Polling                         | Weighed in the frontend spec; native `EventSource` chosen for the reasons above                          |

The backend spec records no alternative to Postgres NOTIFY as the fan-out.

## Consequences

### Positive

- No broker needed for fan-out across api replicas.
- Reconnect and resume are handled by the browser and `seq`.
- Tenant safety: notifications carry only ids; data is re-read under RLS.

### Negative

- One dedicated Postgres connection per api replica.
- Requires no buffering of `text/event-stream` through the Vite proxy,
  Traefik and the Cloudflare Tunnel (open checks).

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §6.2, §7.4
- [Frontend design](../superpowers/specs/2026-11-12-frontend-design.md) §2, §5, §11, §13
- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §9.3, §15
- [PRD (PoC)](<../Agent Desk — PRD (PoC).md>) §6 non-functional targets
- Related: [0014](0014-terminal-over-websocket-exec-relay.md)
