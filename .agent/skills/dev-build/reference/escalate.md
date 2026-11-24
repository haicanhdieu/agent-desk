# MUST ESCALATE (needs_human)

Read by the Advisor before it rules, and by the orchestrator when it checks the ruling (`dev-build` and `dev-review`). Any one item is enough:

1. **Architecture:** the answer changes the architecture, contradicts, narrows or supersedes an accepted ADR, or needs a new ADR (docs/adr/README.md "When an ADR is required"; docs/conventions/git-workflow.md §4). E.g. a new framework, library, datastore, queue or protocol used by more than one module, a new package or dependency direction, a new seam or contract shape, or a change to how runs are isolated, triggered, observed or delivered.
2. **Unmet requirement:** it leaves a requirement or acceptance criterion of the issue, spec or plan unmet, partly met, or put off to later.
3. **Changed requirement:** it changes, narrows, widens or reinterprets a requirement, or picks between two readings of one that give behavior a user would notice as different.
4. **Rule break:** it would break or weaken any AGENTS.md rule or convention MUST. That includes weakening lint, type, test or coverage checks (skipping or deleting tests, ignore comments, thresholds, baselines, excludes); editing agent config, CI, CODEOWNERS or the coverage files; secrets in Postgres, logs, events, errors or commits; a query outside withOrg or org/project scope, or a looser RLS policy; missing authz on an endpoint or terminal attach; webhook signature checks; untrusted text in shell, k8s specs or SQL; editing an applied migration; provider names outside adapters; contracts first; layering; and scope (only what the ticket asks, about 800 changed lines).
5. **Security posture:** it touches a sensitive path (git-workflow.md "Sensitive paths") in a way that changes who can do or see what, what a run pod can reach, how secrets or tokens flow, or how tenancy is enforced.
6. **Missing source:** the ticket, spec or plan is missing, silent or self-contradictory, so deciding means inventing the requirement: writing a task list or plan, making up repro steps or the expected behavior, or ruling on a bug no one can reproduce.
7. **Product call:** a product, UX, user-facing wording or naming, or business-rule choice that no rank 1-3 source settles.
8. **Irreversible or outward-facing:** losing or rewriting existing data, a breaking contract or API change, deleting something others use, anything sent outside the repo, or a choice git-workflow.md §4 calls costly to reverse.
9. **Authority conflict:** two sources conflict and you cannot tell which is newer and accepted, or the newer one is not accepted and the ticket does not link it.
10. **Low confidence:** CONFIDENCE is low, or medium with REVERSIBILITY costly.
11. **Repeat:** this question, or the same one reworded, is already in "Decisions already made", or it disputes one of those decisions. There is no second round on the same point.
12. **Gate:** the answer would skip or overrule a gate of the workflow. dev-build: turn a Triage BLOCKED into a GO for any reason other than bug-or-feature, let a failing check pass, or leave a real finding unfixed. dev-review: merge with a critical, high or medium finding open, waive a failing CI job, merge a PR that changes agent rules or CI, or skip a review round or dimension.
13. **Secret exposed:** a secret is in a commit, a log or run output. A human must rotate it.
