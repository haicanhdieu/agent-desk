# Skill change requests design

Status: draft. Sensitive path: touches the code host adapters (GitHub and fake) and the skills routes; no auth, secrets, RLS, migration or terminal code.
Source: issue #265

## Summary

Saving or deleting a skill commits straight to the project's default branch. When that branch is protected the write is refused, so the change cannot be made.
Now the code host adapter detects a protected default branch and, in that case, puts the change on a new branch and opens a change request (a PR on GitHub). The API returns a provider-neutral result so the web app can say "submitted for review" instead of "saved".

## Contract

- `SkillChangeResult` (core adapter seam) and `SkillChangeResponse` (contracts) are one discriminated union on `kind`:
  - `commit`: `commitSha`, `targetBranch`.
  - `change_request`: `sourceBranch`, `targetBranch`, `url`, `id`.
- `skills.put` and `skills.remove` both respond with it. `skills.remove` used to answer 204 with no body; it now answers 200 with the union.
- `ProjectDto.defaultBranch` (string or null) is added so the UI can name the target branch. Projects that predate the column read null; the UI then says "the default branch".
- No provider name appears in contracts or routes. Provider code is only in the GitHub and fake adapters.

## Behaviour

- Detection: the adapter reads the default branch's metadata (`protected` flag) before writing. Nothing else decides the path. A failed direct write is never retried as a change request.
- Not protected: direct commit as before.
- Protected: create branch `agent-desk/skill-<create|update|delete>-<name>-<base36 timestamp>` from the branch head, commit the change to it, open a change request against the default branch. The suffix keeps concurrent submissions apart; creating a ref never overwrites one.
- Name collision: the host's "reference already exists" maps to `SkillBranchExistsError`, answered as 409 "Submit again."
- Stale edit (sha mismatch on the commit) stays `SkillConflictError`, 409 "Skill changed since it was read".
- Cleanup: if the commit or the change request step fails after the branch was created, the branch is deleted best effort and the original error is kept.
- Other failures become `SkillChangeRequestError` with a stage (`branch`, `commit`, `change_request`, `permission`) and answer 502 with a fixed text per stage. Provider text never reaches the client.
- Web: a `change_request` result shows a banner with the branches and a link (http or https only). The live skill and its lists are not refetched, since the target branch is unchanged until the change request is merged. A `commit` result behaves as before.
- Fake adapter: a per repo "protected" flag in the fake store makes it return change requests, recorded in the store, so local and e2e runs can exercise the flow.

## Access

Unchanged. No permission or role is added; `access.ts` is not touched.

| Route         | Permission     | Level   | Tenant data touched                                                                          |
| ------------- | -------------- | ------- | -------------------------------------------------------------------------------------------- |
| `skills.put`  | `skill:update` | project | Project row (org and project scoped via `withOrg`), its code connection, the skill in the repo |
| `skills.remove` | `skill:delete` | project | Same                                                                                         |

The guard order, 404 for another org's or project's record, and the tests for them are the existing ones for these routes. The new result fields carry only branch names and a change request URL for the caller's own project repo.

## Agent calls

- Agent call: detection uses branch metadata only, not a rules API, because it needs no extra token scope.
- Agent call: no retry of a refused direct write as a change request, so a permission error is reported, not hidden.

## Needs approval

None. No new dependency.
