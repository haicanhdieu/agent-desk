# Area: Business logic

What the change must do for whom, and the rules it must keep. You own the spec's `## Business rules` section.

## Deep-dive items

Work through every item. An item the requirement does not touch gets one line in your findings saying so; never drop it.

1. **Actors and roles.** Who asks for this, who triggers it, who sees the result: org admin, member, viewer, project owner, an outside party (a ticket source, an SCM webhook sender). Which role may do each action.
2. **Goal and success.** The user problem in one or two sentences, and what a user can do or see when it is solved.
3. **Scope boundary.** What the requirement states as in and out. Add no scope, requirement or non-goal it does not state (AGENTS.md › Agent work rules).
4. **Domain rules and invariants.** What must always hold. Every status or state machine touched (ticket, run, session, connection): each allowed move, each forbidden one, and who or what makes it.
5. **Inputs, validation and limits.** Each input: format, required or optional, min/max, size, count, quota, rate limit, default.
6. **Edge cases.** Empty, duplicate, concurrent edits, retry and idempotency, partial failure, timeout, cancellation, a deleted or disconnected dependency (repo, connection, secret).
7. **Tenancy and permission.** Org and project scope of every read and write (AGENTS.md rule 4); what a user of another org or project must never see or change; authz per action (rule 7).
8. **Data lifecycle.** Create, change, delete, archive, retention, history and audit trail; what happens to existing records.
9. **Provider-agnostic terms.** Name concepts generically (connection, scm, ticket source), never by provider (rule 3).
10. **Untrusted text.** Which ticket, comment or repo text the feature reads or shows, and that it is data, never a command (rule 6).
11. **Compatibility.** Existing users, data and behaviour this changes, and how they move over.
12. **Side effects a user sees.** Comments posted on a ticket, status changes, notifications, events on a live stream.
13. **Existing decisions.** Specs in `docs/superpowers/specs/` and ADRs in `docs/adr/` on the same feature: what they settle, and any conflict with the requirement.
14. **Rules as the user sees them.** These rules become the e2e requirements later (phase 5 writes test cases for each), so a rule missing here is behaviour that never gets tested. Method: [qa-write-e2e-test-cases/guides/extracting-rules.md](../../../qa-write-e2e-test-cases/guides/extracting-rules.md), its Step 1, Step 2 with the category checklist, and "Split and merge"; ignore its JSON, ids, schemas and `validate.mjs`.
    - **One surface,** the outermost the change reaches: the UI if any screen, control, text or state a person sees changes; else the API contract (route, request fields, response status and shape, error); else the CLI, webhook or other interface an outside party uses.
    - **Follow backend changes outward.** "A now stores X" is not a rule; "When a member saves A with X, the list shows X after a reload" is. When a change reaches several screens or flows, each is a rule.
    - **Each rule** is `BR-<n>`, has a category from the checklist, and reads "When <condition>, <actor> <does what> → <what they then see>". It names the input, control or request and the observable result, never a table, queue, workflow, function or file. Items 4 to 7 and 12 are sources of rules too: each state move, limit, edge case, permission and visible side effect a user can observe is a rule.
    - **Not observable:** a decision no user can see at that surface is listed with the reason, never dropped.
    - **From the requirement, not the code.** A rule says what should happen. Today's code is evidence of current behaviour (item 11), never the source of a rule: a rule copied from it would make the tests agree with a bug. A label, format or empty, loading or error state the requirement leaves out is looked up in sibling specs, ADRs and prototype boards first and cited; only what none states is asked.
    - **Ids are stable across rounds.** Never renumber; a dropped rule's id is not reused.

## Design fields (in your `STATUS: design` reply)

```text
GOAL: <the user problem and what a user can do when it is solved; at most 2 lines>
ACTORS: <one line per actor: who, and what they may do>
SURFACE: <UI | API | CLI | webhook | …>: <why it is the outermost surface the change reaches>
RULES: <one line per rule: "BR-<n> [<category>] When <condition>, <actor> <does> → <what they see>">
NOT OBSERVABLE: <one line per decision no user can see at the surface: the decision, why, and the BR-<n> that covers its effect if any; or "none">
STATES: <one line per state move, allowed or forbidden; or "none">
LIMITS: <one line per input limit or quota; or "none">
EDGE CASES: <one line per edge case and its outcome>
TENANCY: <org/project scope and who must never see or change what; one line each>
LIFECYCLE: <create, change, delete, retention, audit; or "none">
COMPATIBILITY: <existing users, data and behaviour and how they move over; or "none">
SIDE EFFECTS: <comments, status changes, notifications, events a user sees; or "none">
OUT OF SCOPE: <only what the requirement states as out; or "none stated">
```
