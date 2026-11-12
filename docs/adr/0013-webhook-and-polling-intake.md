# 0013. Webhook and polling intake feeding one router

- Status: Accepted
- Date: 2026-11-11
- Source: PRD (PoC) G1, FR-22 to FR-25; Architecture (PoC) §4, §9 (Trigger mechanism); commit `d5561c4`; control plane design §6.1, §6.4

## Context

Runs are triggered by slash-command comments on tickets. Webhooks are
near-instant but need the code host to reach the control plane, which a laptop,
a local cluster or a locked-down network cannot offer. The PRD makes "no public
URL" a first-class setup path, not a dev-only fallback.

## Decision

Each project has a trigger mode, Webhook (default) or Polling, chosen at setup
and changeable later:

- Both intakes produce the same `TicketEvent` and feed one pure router (parse
  command, authorize, match rule, guard), so rules, authorization, guards and
  dedupe do not depend on the mode.
- Dedupe: `inbound_events` unique on (provider, delivery_id), and `runs` unique
  on (project_id, trigger_comment_id), so one comment starts at most one run
  whichever path saw it, including during a mode switch.
- Polling uses conditional requests (ETag, `since` cursor) at 5, 10, 15 or
  30 min; the cursor lives in Postgres. In the control plane design each
  project's poll is a Temporal Schedule; rate limits pause until reset,
  revoked tokens pause with a visible reason, errors back off.
- Projects default to Polling for local development.

## Alternatives considered

| Alternative                                       | Why rejected                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| GitHub Actions as the runner                      | Set aside in Architecture §9; no further reason recorded                   |
| Polling as a dev-only fallback                    | Set aside; the PRD needs Polling for real deployments without a public URL |
| Webhook projects also poll slowly as a safety net | Open question (PRD Q5); not adopted for the PoC, though dedupe allows it   |

## Consequences

### Positive

- Works with no public URL, no relay or tunnel.
- After a restart, polling resumes from the cursor and catches missed comments.
- Chaining works in Polling mode without depending on App-authored webhooks.

### Negative

- Polling adds up to one interval of latency per run and per chain handoff.
- Two intake paths to test, including the switch-while-comments-arrive case.
- Open checks: App-authored comments deliver webhooks; 304 does not count
  against the rate limit; `since` semantics; App with an inactive webhook.

## Links

- [PRD (PoC)](<../Agent Desk — PRD (PoC).md>) §2, §4, §5, §7, §8
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §4, §9
- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §6.1, §6.4
- Related: [0005](0005-provider-agnostic-naming-adapter-seams.md), [0009](0009-temporal-for-durable-work.md)
