# 0035. Per-request org check and the /auth allow-list

- Status: Accepted
- Date: 2026-11-21
- Source: [org onboarding design](../superpowers/specs/2026-11-21-org-onboarding-design.md) (Active org, Architecture: org header check and `/auth/*`, `setActive` latency); [plan](../superpowers/plans/2026-11-21-org-onboarding.md) Tasks 3, 9, 11 and 12
- Amends: [0003](0003-vite-spa-tanstack-router.md), [0008](0008-better-auth-in-process.md), [0014](0014-terminal-over-websocket-exec-relay.md)

## Context

The org a request acts on is the session's active org (better-auth `activeOrganizationId`). With an org switcher and several tabs, the URL can name one org while the session points at another (a switch made in a second tab), so a request could act on an org the page is not showing. A WebSocket terminal is long-lived, so the same drift can happen after it connects. Separately, better-auth exposes many routes under `/auth` (the organization plugin's own create, invite and accept routes among them) that bypass the RBAC checks of the contracts routes; the old deny-list had to name each one.

## Decision

- **The URL org is named on every request.** The web sends `x-org-id` (header) on every API request and `orgId` (query param) on SSE and terminal URLs (`ORG_HEADER`, `ORG_QUERY_PARAM` in `packages/contracts`). The header wins over the param.
- **A mismatch is refused before any side effect.** The guard compares the named org with the session's active org after the session check and before membership, lookup or body validation. A different org, or any org when there is no active one, answers 409 with problem type `org-mismatch`; SSE gets the same 409 before the stream opens; the terminal closes `4412` before any byte or exec. No row, signal, secret or audit entry is written. An absent header means the session org (curl, tests). The `user` and `platform` guard kinds ignore it.
- **The terminal stays on the org it connected to.** The org is fixed at connect (`conn.orgId`). The timed reauth re-checks the session, membership and `terminal:attach` in that org, never the session's current one: a switch in another tab does not close the socket, and losing membership or the assignment in the connect org still closes 4403.
- **The web resyncs.** On a 409 `org-mismatch`, an SSE error or a 4412, the web calls `setActive` for its URL org, drops the org-keyed cache and reloads. A read is invisible to the user; a write is never retried and shows "This organization was switched in another tab. Try again."
- **`/auth` is an allow-list.** Only `/get-session`, `/sign-in/social`, `/callback/*`, `/sign-out`, `/organization/list`, `/organization/set-active`, `/ok` and `/error` are answered; every other path under `/auth` is 404 (normalised: case, repeated slashes, dot segments, trailing slash). Dev-login is its own controller and server code calls `auth.api` directly. A new better-auth route stays unreachable until it is listed.
- **`setActive` latency check, closed by reasoning.** The open check of ADR-0008 asked whether switching the active org on navigation costs too much. The web sends one `setActive` POST only when the URL org differs from the session org; navigation inside the same org sends none. One POST per switch is accepted, and no timing test is written.

## Alternatives considered

| Alternative                                                           | Why rejected                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Keep the session's active org as the only truth                       | A switch in a second tab silently redirects the first tab's writes to another org                                   |
| Change the session's org from the request (the URL wins by switching) | A request would have a side effect on the session, and a stale tab could flip it back                               |
| Put the org in every API path                                         | The routes already use `/api/orgs/:orgId` only for management; changing the route table is far larger than a header |
| Keep the `/auth` deny-list and add paths                              | A new better-auth release silently exposes new routes; deny-by-default is safer                                     |
| Re-check the session's current org on terminal reauth                 | A tab switch would close a healthy terminal, or check an org the socket is not attached to                          |

## Consequences

### Positive

- A request, stream or terminal never acts on an org other than the one the page shows, and the refusal has no side effect.
- Unlisted better-auth routes are unreachable by default.

### Negative

- Every web request carries a header, and two tabs on different orgs resync with an extra `setActive` call.
- A client that sends a wrong `x-org-id` gets 409 even when the session org would have been fine.

## Links

- [Org onboarding design](../superpowers/specs/2026-11-21-org-onboarding-design.md)
- Amends: [0003](0003-vite-spa-tanstack-router.md), [0008](0008-better-auth-in-process.md), [0014](0014-terminal-over-websocket-exec-relay.md)
- Related: [0031](0031-scoped-rbac-roles-assignments.md)
