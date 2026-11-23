# Severity

Every finding gets exactly one severity: the highest level whose description fits. Torn between two, pick the higher and say why in `why`.

| Severity     | Checklist label | Fixed before merge |
| ------------ | --------------- | ------------------ |
| **critical** | blocker         | yes                |
| **high**     | blocker         | yes                |
| **medium**   | should-fix      | yes                |
| **low**      | nit             | no, listed only    |

- **critical:** Security or tenancy hole (missing authz, unscoped query, bypassed `withOrg`/RLS, secret in code/logs/DB/events, untrusted text into shell/SQL/k8s spec/HTML, unverified webhook). Wrong architecture (layering broken, app imports app, types duplicated outside `packages/contracts`, provider names outside adapters, non-deterministic workflow code, k8s/secrets/providers called around their seam, edited applied migration). Data loss. Damaging performance (unbounded query or list on a hot path, N+1 per request, leak of sockets/streams/watches, blocking the event loop). Breaks the build or the API contract.
- **high:** Wrong behavior against the issue or spec, including its failure cases. New behavior or fixed bug with no test that fails without it. A **MUST** in `docs/conventions/` broken (not already critical). Unhandled error, floating promise, race between api and worker, missing idempotency on webhook/poll/activity code. A performance problem that bites at modest scale (missing index for a new query, re-render storm, unpaginated list that will grow).
- **medium:** A **SHOULD** in `docs/conventions/` broken. Missing edge case (empty, duplicate, very large, out of order). UI missing a loading, empty or error state or a story. Weak error message or log (no context, wrong level). Design that will cost maintenance: unclear responsibility, duplicated logic, leaky abstraction. Flaky-prone test (sleeps, real time, order-dependent).
- **low:** Nice to have: naming, readability, small refactor, comment wording, a cheaper approach with no measurable impact. Never anything Prettier or ESLint owns.

**Requirements.** A requirement or acceptance criterion of the issue/spec/plan with no implementation, or implemented differently from its text, is high. A partly covered one (missing failure case, no test for it) is medium, or high if the core behavior is missing. A requirement that the issue itself marks optional or out of scope is not a finding.

**Spec, plan or ADR.** Rate the doc as written: medium or above only if it contradicts the issue or spec, breaks a convention, or would make the implementation wrong. A missing detail, a hardening idea or a better design is low.

Not a finding: style that tools own, preferences with no rule behind them, code the PR did not touch (unless the PR's change makes it wrong), and speculation with no concrete failure scenario.

## Validity test (before anyone fixes a finding)

A finding is **valid**, and only then worth a change, when all three hold on the current head:

1. **Real.** The failure scenario actually happens in the code as it is now (read the file and the callers, or run a test). Not already fixed, not guarded elsewhere, not speculation.
2. **Violates something written.** It breaks a named source: the issue or spec requirement, an ADR, `AGENTS.md`, a rule or MUST/SHOULD in `docs/conventions/`, or a standard a reader can point to (a security or correctness property with a concrete failure). "I would do it differently" is not a violation.
3. **In scope and safe to fix.** The code is something this PR adds, changes or makes wrong, and the suggested fix works with how the repo's tooling really runs and does not break another rule.

Fail any one and the finding is **declined**, with the reason as one of `NOT_REAL`, `NO_RULE_VIOLATED`, `OUT_OF_SCOPE`, `FIX_UNSAFE` (a real, valid finding whose suggested fix is wrong: the fixer proposes a better fix or declines) or `ALREADY_FIXED`, plus the evidence (file:line read, test run, rule text). A decline needs evidence; "I think it is fine" is not one. When you cannot tell, do not fix and do not decline silently: report `UNSURE` with what you checked.
