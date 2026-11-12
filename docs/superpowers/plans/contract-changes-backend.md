# Backend contract changes (additive only)

| Task | Route / schema                                            | Change                                                                                                                                                                     | Why                                                                                                                 |
| ---- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 17   | `runs.events` (`GET /api/runs/:runId/events?after=`)      | New route. Response schema `RunStatusEvent` documents the `event: status` frame; `event: event` frames are `RunEventMessage`. `after` is an optional non-negative integer. | The SSE endpoints existed in the spec and schemas (`RunStatusEvent`, `RunEventMessage`) but not in the route table. |
| 17   | `projects.events` (`GET /api/projects/:projectId/events`) | New route. Response schema `ProjectRunEvent` documents the `event: run` frame.                                                                                             | Same.                                                                                                               |
| 17   | `routes.test.ts`                                          | Flattened route count 27 -> 29.                                                                                                                                            | Two new routes.                                                                                                     |

Non-contract config added in Task 17: `SSE_HEARTBEAT_MS` (default 15000, min 10) in `packages/core` config and `.env.example`.

## Task 17 fix round 1

| Task | Route / schema              | Change                                                                                                              | Why                                                    |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 17   | `runs.events` query `after` | Tightened on this new route: `max(2147483647)` (run_events.seq is int4); over-range is a 400 with pointer `/after`. | An over-range value reached Postgres and returned 500. |

Config: `SSE_SAFETY_TICK_MS` (default 30000, min 10) added next to `SSE_HEARTBEAT_MS`. `listenRunStatus` gained an optional `onReconnect` callback (packages/db).

## Task 18

| Task | Route / schema                                    | Change                                                                                                                                           | Why                                                            |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 18   | `runs.terminal` (`GET /api/runs/:runId/terminal`) | New route (WebSocket upgrade; response `null` placeholder: the socket carries binary frames, text resize frames and close codes 4401/4403/4409). | The terminal route was in the spec but not in the route table. |
| 18   | `routes.test.ts`                                  | Flattened route count 29 -> 30.                                                                                                                  | One new route.                                                 |

Non-contract config added in Task 18: `TERMINAL_PING_MS` (default 30000, min 10) in `packages/core` config and `.env.example`.
