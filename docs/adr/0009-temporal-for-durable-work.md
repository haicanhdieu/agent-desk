# 0009. Temporal for the run lifecycle and background work

- Status: Accepted
- Date: 2026-11-12
- Source: control plane design §2 (Background work), §3, §6; infra design §2 (Temporal), §6.2

## Context

The Architecture doc used Postgres as the queue: a run controller loop claims
queued runs with `SELECT … FOR UPDATE SKIP LOCKED`, and a startup reconcile
fixes state after a crash. It listed NATS and Temporal as the alternative, to
revisit with "multiple control-plane replicas or long multi-step workflows".
The control plane design targets a horizontally scaled api and a path to
multi-step chains. A run's lifecycle has signals (finish, cancel, terminal
attach/detach, turn finished) and timers (idle, hard timeout, pending limit).

## Decision

Use Temporal from day one, run by `apps/worker`:

- `RunWorkflow` per run (`run-{runId}`), `ProjectGateWorkflow` per project
  (FIFO concurrency gate), Schedules for polling, the outbox sweep and the
  daily reconcile.
- The `runs` table is the read model; Temporal holds execution state; only the
  `setRunStatus` activity writes run status.
- An outbox sweep starts workflows for runs left `queued` by an api crash or a
  Temporal outage.
- Infra: one `temporalio/server` process on the shared Postgres in QA; Temporal
  Cloud is possible later.

## Alternatives considered

| Alternative                                                     | Why rejected                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Hand-rolled `SKIP LOCKED` loops (Architecture doc's PoC choice) | Weighed; Temporal gives durable lifecycle with signals and timers, replay after crashes, and a path to multi-step chains |
| pg-boss, graphile-worker, BullMQ                                | Weighed; same reasons                                                                                                    |
| Official multi-service Temporal chart (infra)                   | One pod fits the QA memory budget and still uses real persistence                                                        |
| `temporal server start-dev` (infra)                             | Weighed; one real-persistence process chosen instead                                                                     |

## Consequences

### Positive

- Worker crashes replay; `followPodLogs` resumes from its heartbeat and stored seq.
- Temporal's durable state replaces the Architecture doc's startup reconcile.
- Time-skipping workflow tests cover idle, timeout and cancel paths.

### Negative

- A Temporal cluster to run (its own databases on the same Postgres), 256 → 448 Mi
  in the QA budget; single-process memory is an open check.
- Two sources of truth (read model and workflow state) to keep consistent.

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §2, §3, §6, §9
- [Infra design](../superpowers/specs/2026-11-12-infra-design.md) §2, §6.2, §6.3
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §4, §9 (Queue row)
- Related: [0002](0002-nestjs-on-fastify-backend.md), [0010](0010-one-kubernetes-job-per-run.md)
