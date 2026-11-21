# 0033. Live PR state through the board adapter

- Status: Accepted
- Date: 2026-11-21
- Source: [Show PR status colors design](../superpowers/specs/2026-11-21-show-pr-status-colors-design.md) (issue #202)

## Context

Every PR icon in the app should show the PR's state (open, draft, merged, closed). The state changes on the provider
without any event reaching us, so a stored copy would go stale and need a migration, a backfill and a sync job. The
Runs and Run detail pages must not wait for a provider call.

## Decision

- The state is read live from the ticket source at request time and is never stored: no column, no migration.
- A separate, non-blocking endpoint (`GET /api/projects/:projectId/tickets/pr-states`) serves it. The pages render
  first and colour the icons when the answer arrives.
- `BoardAdapter.prStates(project, refs)` is the seam. The GitHub adapter asks for all refs in one batched GraphQL call
  (numbers, owner and repo as variables only) with the installation token; the fake adapter reads a state stored on
  its fake tickets. Refs that are not PRs, are not found or have an unknown state are left out.
- The API keeps a per-project/PR TTL cache (60 s, at most 10,000 entries, oldest evicted). It holds only `PrState`
  values and is read only after the project check.
- Failure means unknown: a failure, timeout or rate limit gives 200 without those refs, is not cached, and logs the
  project, the ref count and the error name only. The UI stays neutral and silent.

## Alternatives considered

| Alternative                                | Why rejected                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| Store the state on tickets or runs         | Goes stale without events; needs a migration and a sync job.           |
| Add the state to the runs and tickets DTOs | Blocks every list on a provider call and couples them to its uptime.   |
| Listen to PR webhooks and keep a copy      | New intake path and signature surface; still stale after missed hooks. |

## Consequences

- Each PR on screen costs at most one provider read per minute per project (batched), bounded by the cache.
- A provider outage leaves icons neutral; nothing else changes.
- Other ticket sources implement `prStates` or leave every ref unknown.
