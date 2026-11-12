# 0003. Vite SPA with TanStack Router and org-scoped URLs

- Status: Accepted
- Date: 2026-11-12
- Source: frontend design §2 (Rendering and routing, URL scheme, Serving), §3.4

## Context

`web/` already holds a design system, composites and about 25 presentational
screens with Storybook, but no router, data layer or app shell. NestJS owns
auth, sessions and the API ([0002](0002-nestjs-on-fastify-backend.md)). Every
page is behind sign-in. Orgs are coming, so URLs must survive their arrival. The
2026-11-11 decisions log left the route scheme open (hardcoded `/runs`, `/desk`,
`/projects`).

## Decision

- A Vite single-page app with TanStack Router file-based routes.
- URL scheme `/o/$org/p/$project/...`, with `$org` the organization slug and
  `$run` the per-project run number.
- Search params are typed with Zod `validateSearch`; invalid values fall back to
  defaults.
- The built SPA is served as a static container on the same origin as `/api`,
  behind the same ingress.
- Screens never import the router; `ds` gets a `LinkProvider` and the app passes
  a `createLink` router link into it.

## Alternatives considered

| Alternative                                                        | Why rejected                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Vite SPA + React Router v7 data mode                               | Weighed; TanStack Router chosen for typed route and search params and the `/o/$org` layout                    |
| React Router v7 framework mode, TanStack Start, Next.js App Router | Server rendering is not needed: Nest owns auth and the API, and every page is behind sign-in, so no SEO       |
| Flat `/runs`, `/desk` URLs                                         | Deep links would break when orgs arrive                                                                       |
| Subdomain per org                                                  | Weighed; no specific reason recorded beyond choosing the path scheme                                          |
| Nest serves the files; CDN                                         | Separate static container keeps same origin (no CORS, first-party cookie) and deploys separately from the API |

## Consequences

### Positive

- Same origin: no CORS, first-party session cookie, SSE and WebSocket on one host.
- Deep links stay valid when org switching arrives; caches are org-scoped.
- Screens stay renderable in Storybook with fixtures.
- Settles the open route-scheme item from the 2026-11-11 decisions log.

### Negative

- The `$org` layout must resolve the slug and call `organization.setActive` on
  mismatch, then clear org-scoped cache (latency is an open check).
- Open check: TanStack Router file routes with the Vite 8 plugin.

## Links

- [Frontend design](../superpowers/specs/2026-11-12-frontend-design.md) §2, §3.3, §3.4, §13
- [Decisions log 2026-11-11](../superpowers/plans/2026-11-11-decisions.md) "Awaiting you"
- Related: [0004](0004-contracts-first-zod-schemas.md), [0006](0006-tenant-ready-schema-with-rls.md)
