# Rule custom prompt — design

Date: 2026-11-13 · Status: draft for approval

## Intent

Today a rule (`/command` → skill) can only bind a skill from the repository's `.agent/skills`. Users want to set up a
rule quickly by typing what the agent should do, without first writing and committing a skill. A rule therefore binds
**either** a skill **or** a custom prompt, never both.

Users write only their own instructions. Agent Desk still adds the fixed system part (which ticket, read the comments,
the arguments, report back). Users cannot edit the system part, but they can always see it: as a preview in the rule
form, and as the final prompt on each run.

## Goals

- When creating or editing a rule, the user picks **Skill** or **Custom prompt**.
- The custom prompt is free multi-line text, up to 4,000 characters.
- The rule form shows the system part below the textarea, read-only and served by the API.
- Each run shows the final prompt it was started with. Known secret values are redacted, as in run output; this is a
  builder call where the secrets rule wins over "exact".
- Editing a rule never changes a run that has already been queued.

## Non-goals

- Placeholders or templating inside the custom prompt (approach B, below).
- Prompt versioning or history beyond the copy each run keeps.
- Turning a custom prompt into a skill, or a skill into a custom prompt.

## Anti-goals

- Any way to remove or override the system part from the UI or the API.
- Secrets inside prompts. The prompt is stored in Postgres, so the form warns about this. Run output is still redacted
  as it is today.
- Ticket, comment or user args text ever reaching a shell or a k8s spec. The prompt keeps going to the runner as data
  through an env var.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **A (picked)** | The custom prompt replaces only the first line of the template ("Use the skill … on …"). The system lines stay. | Simple for users and hard to break. The template gets one small change. |
| B | The custom prompt replaces the whole template, with `{ticket}`, `{repo}` and `{args}` placeholders. | Full control, but a user who forgets `{ticket}` gets a run with no context, and we take on a placeholder language. |
| C | Save the prompt as a hidden skill under `.agent/skills` and bind it. | Nothing downstream changes, but it clutters the skills list and blurs what a skill is. |

The user picked **A**, with one addition: the system part is not editable but must be visible.

## Design

### Prompt shape

A skill rule keeps today's four-line template exactly. A prompt rule renders as:

```
<custom prompt, kept as written, multi-line>
Ticket: <issue|pull request> #<n> in <repo>. Read it and all its comments with the gh CLI before you start.
Arguments from the user: <args, collapsed to one line>
When done, report on the ticket.
```

- The custom prompt is written by a signed-in org member through the rules screen, so it keeps its line breaks.
- `args` comes from the ticket comment and is untrusted, so it is still collapsed to one line.
- The system lines always come last, so the custom text cannot push them out of place. The custom text can still argue
  with them. See the accepted risk below.

### Accepted risk: any org member can write a prompt rule

The rules endpoints check org membership but not role, and RBAC is out of scope for now (decided 2026-11-13). So any
member can create or change a prompt rule, and every later `/command` run follows that text with the bot's repo token.

For example, a member could add "push straight to main" to `/fix-bug`, and everyone's later `/fix-bug` runs would
follow it. Skills carry a similar exposure, but changing a skill needs push access to the repository. A prompt
rule needs only desk membership, so the bar is lower.

The security reviewer should judge it on that basis. Role-gating prompt rules is the first thing to add when RBAC lands.

`buildPrompt` in `packages/core/src/router/prompt.ts` stays the single source of the template. Its input becomes a
union: `{ skillName } | { customPrompt }` plus the ticket fields it already takes.

### Contracts (`packages/contracts`)

- **`CreateRuleRequest`** becomes a discriminated union on `kind`:
  - `{ kind: 'skill', skillName: SlugName, … }`
  - `{ kind: 'prompt', prompt: z.string().trim().min(1).max(4000), … }`
- **`RuleDto`** gains `kind` and `prompt: string | null`, and `skillName` becomes nullable.
- **`UpdateRuleRequest`:** switching kind sends the new `kind` together with its field. A partial update that leaves the
  rule with neither field, or with both, is a 422.
- **New route `rules.promptPreview`:** `GET /api/projects/:projectId/rules/prompt-preview` returns
  `{ systemLines: string[] }`. The lines are rendered by `buildPrompt` with placeholder values (`<issue or PR #number>`,
  the project's real repo path, `<text after /command>`). It is authorised like `rules.list`.
- **`RunDto` / run detail:** gains `ruleKind`, `prompt: string | null` (the custom text) and `finalPrompt: string | null`
  (null for runs started before this change).

### Database (`packages/db`), one new migration

- **`rules`:**
  - add `prompt text null`
  - make `skill_name` nullable
  - add a check that exactly one of `skill_name` and `prompt` is non-null
  - add a check `char_length(prompt) <= 4000`
- **`runs`:**
  - add `prompt text null`, copied from the rule at intake
  - add `final_prompt text null`, written by the worker when it builds the Job
  - make `skill_name` nullable
- **No `kind` column.** `kind` is derived from which field is set, so it can never disagree with the data.

### Routing and intake (`packages/core`)

- **`RuleRow`** gains `prompt`.
- **Duplicate-run check:** today it blocks a second active run of the same skill on a ticket. For a prompt rule it keys
  on the rule id instead. `counts` gains `activeRuleIdsOnTicket` beside `activeSkillsOnTicket`.
- **Intake** copies `rule.prompt` (or `rule.skillName`) onto the run row.

### Worker (`apps/worker`)

- **Prompt:** builds it from the run row (skill or prompt), then writes `final_prompt` before creating the Job.
- **Redaction:** `final_prompt` is redacted with the same known-secret list as run output before it is stored.
- **Start comment:** for a prompt rule it says "custom prompt" instead of "skill `x`".

### API (`apps/api`)

- **`rules.service`:** skips `assertSkillExists` for prompt rules.
- **Prompt preview:** a new handler for `promptPreview`.

### Web (`apps/web`)

- **Rule form:** a segmented **Skill / Custom prompt** control. Custom prompt shows:
  - a textarea with a character counter and the hint "Don't paste passwords or tokens. This text is stored."
  - the read-only system part from `promptPreview`, under the label "Added by Agent Desk (can't be edited)"
  - loading, empty and error states for the preview
- **Rules list:** shows "Custom prompt" plus the first line of the prompt where the skill name used to go.
- **Run detail:** a collapsible **Prompt** section with `finalPrompt`, or "Not recorded" for older runs.
- **Form plumbing:** `rules.form.ts` field maps and `changedFields` handle `kind` and `prompt`; MSW mocks and stories
  are updated.

## Constraints

- **Human review:** the prompt template is listed as sensitive in `docs/conventions/security.md`, and this adds a
  migration.
- **Rules:** contracts first, never edit an applied migration, and no provider names in new fields.
- **PR size:** around 400 lines each, so this splits into about three PRs:
  1. contracts, db, core
  2. worker, api
  3. web

## Left to the builder

- Exact copy of the hint and labels; the field and route names above may be adjusted to fit local conventions.
- Whether the preview is fetched once per form open or cached with TanStack Query (cached is fine).
- Test layout. Unit tests are required for `buildPrompt` (both kinds, multi-line prompt, args collapse), the rule union
  schema, the DB check constraint, and the duplicate-run check for prompt rules.
