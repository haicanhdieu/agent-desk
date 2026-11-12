# 0008. better-auth in process for authentication

- Status: Accepted
- Date: 2026-11-12
- Source: control plane design §2 (Auth), §4.1, §5; frontend design §2 (Auth client), §4.4

## Context

The PoC signs in with GitHub only (the Architecture doc used the GitHub App's
OAuth flow). The roadmap adds Google, Apple, Keycloak or generic OIDC, and SAML,
plus orgs and SSO ([0006](0006-tenant-ready-schema-with-rls.md)). GitHub must
also be linkable to a user who signs in another way, because completing a code
host install verifies access with the user's linked GitHub account.

## Decision

Run better-auth inside `apps/api`, mounted at `/auth/*`:

- GitHub provider first, against the GitHub App's OAuth credentials.
- Organization plugin: a personal org per user on first sign-in; the session
  carries `activeOrganizationId`.
- Account linking, so GitHub can be linked when it is not the login method.
- The web app uses the better-auth React client (same-origin `baseURL`,
  organization plugin).

## Alternatives considered

| Alternative                             | Why rejected                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Keycloak broker                         | Something extra to run; a broker can be added later as one more OIDC provider                                    |
| Passport                                | Weighed; better-auth chosen for social and generic OIDC providers, account linking, organization and SSO plugins |
| Hosted IdP                              | Weighed; same reasons, and nothing extra to run                                                                  |
| Hand-written `/auth/*` calls in the web | better-auth client matches the backend and gives the session hook, social sign-in and org plugin                 |

## Consequences

### Positive

- Nothing extra to deploy; sessions are first-party cookies on the same origin.
- Org and SSO support come from plugins rather than custom code.

### Negative

- Open checks: mounting better-auth on Nest with the Fastify adapter and
  reading the session in a guard; the GitHub provider against a GitHub App's
  user-to-server OAuth flow rather than an OAuth App.
- `organization.setActive` runs on org-slug navigation (latency is an open check).

## Links

- [Control plane design](../superpowers/specs/2026-11-12-control-plane-design.md) §2, §4.1, §5, §11
- [Frontend design](../superpowers/specs/2026-11-12-frontend-design.md) §2, §4.4, §13
- [Architecture (PoC)](<../Agent Desk — Architecture (PoC).md>) §7 GitHub App
- Related: [0006](0006-tenant-ready-schema-with-rls.md), [0002](0002-nestjs-on-fastify-backend.md)
