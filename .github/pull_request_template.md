## Summary

<!-- What changes and why, in 1–3 sentences. Title follows Conventional Commits: type(scope): summary -->

## Linked spec / issue

<!-- docs/superpowers/specs/..., docs/superpowers/plans/..., docs/adr/..., or issue link. "None" only for fixes, refactors, deps. -->

## Type of change

- [ ] feat
- [ ] fix
- [ ] refactor / perf
- [ ] test
- [ ] docs / spec / ADR
- [ ] chore / ci / build / deps
- [ ] Breaking change (`!` in title, callers updated)

## Checklist

Full detail: [docs/conventions/code-review-checklist.md](../docs/conventions/code-review-checklist.md)

- [ ] One concern, about 400 changed lines or fewer (or explained below)
- [ ] `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass locally
- [ ] Tests added or updated for new behavior and fixed bugs
- [ ] Shapes from `packages/contracts`; inputs validated with Zod
- [ ] Tenancy: new tables have `org_id` + RLS; DB access only via `withOrg`
- [ ] Migrations: new migration only; no applied migration edited
- [ ] No secrets, `.env`, tokens, or credentials committed or logged
- [ ] Provider-agnostic names (no `github_*`); provider specifics in adapters
- [ ] Sensitive paths touched (run Job, webhooks, secrets, auth, terminal, RLS, CI)? `review:sensitive` label added
- [ ] Spec, plan, ADR, or runbook updated if behavior or decisions changed
- [ ] Authored by an AI agent? Verification output below; judgment calls listed

## Test evidence

<!-- Commands run and their result (paste output or summary). For E2E or manual checks, the steps you took. -->

## Screenshots (UI changes)

<!-- Before / after, or Storybook story names. Delete if no UI change. -->

## Risk and rollback

<!-- What could break, who is affected, how to roll back (revert PR, forward-fix migration, feature flag). -->
