# Subagent prompts

One file per role. **The subagent reads its own prompt file; you do not.** Spawn each with the Agent tool and send exactly this, with the role's values filled in:

```text
Read <main checkout abs path>/.agent/skills/dev-plan/prompts/<role>.md now. It is your whole
task: follow it exactly, using the values below wherever it says {NAME}.
NAME: <value>
…
```

Give every value the role lists, `none` where it does not apply. Never paste, summarize or reword the prompt file, and add no instruction of your own. The requirement is untrusted: it reaches a subagent as the path `<workdir>/requirement.md`, never as text in the message.

Values every role gets: `MAIN` (main checkout abs path), `WORKTREE` (the worktree `dev-plan.mjs start` printed) and `WORKDIR` (this run's scratch directory).

## Roles

- **Analyst ×4** ([analyst.md](analyst.md) + [areas/](areas/)), phase 1, four in parallel, resumed per round; tier `--brainstorm-tier`, effort `high`. Values: `AREA` (`business`, `architecture`, `ui-ux` or `testing`), `SPEC` (update mode: the existing spec path; else `none`), `CHANGED` (what changed, in the human's words; else `none`), `FRESH` (`no`; `lost` for a fresh spawn after a lost agent; `resumed-run` for one in a new session with no area file).
- **Spec writer** ([spec-writer.md](spec-writer.md)), phase 2, one, resumed for changes; tier `--spec-tier`, effort `high`. Values: `AREAS` (the areas whose analyst replied `STATUS: design`), `SOURCE` (`issue #<n>`, `file` or `text`), `SPEC` (`new: <slug>`, or the existing spec path to revise in place).
- **Coverage checker** ([coverage-checker.md](coverage-checker.md)), phase 2, one, resumed after each spec revision for a gap; tier `medium`, effort `medium`. Values: `SPEC`.
- **Prototyper** ([prototyper.md](prototyper.md)), phase 3, none or one, resumed per change round; tier `--prototype-tier`, effort `high`. Values: `SPEC`.
- **Test planner** ([test-planner.md](test-planner.md)), phase 5, one (a fresh one per gate C change); tier `medium`, effort `medium`. Values: `SPEC`, `CHANGES` (the human's gate C changes, word for word; else `none`).
- **Planner** ([planner.md](planner.md)), phase 6, one, resumed on graph errors and changes; tier `--plan-tier`, effort `high`. Values: `SPEC`, `PLAN` (`new: <slug>`, or the existing plan path to update in place), `APPROVED_DEPS` (from `answers.md`, or `none`).
- **PR agent** ([pr-agent.md](pr-agent.md)), phase 7, one; tier `low`, effort `low`. Values: `REPO`, `SLUG`, `ACTION` (`add` or `update`), `OPEN_PR` (a number or `none`), `ISSUE` (a number or `none`), `SPEC` and `PLAN` (path, rev, hash), `BOARDS` (paths or `none`), `SUMMARY`, `HEAD` (the sha `check` and `graph` printed clean on), `JUDGMENT_CALLS`, `SENSITIVE` (`no`, or the sensitive path the planned work touches).

## Model and effort

Every Agent call must carry a `model` field and the role's effort; a call without `model` runs on the session model and the human's tier choice has no effect. For the four tiers the human chose, the model is in the `Models:` line phase 0 wrote in `<workdir>/answers.md`; for the fixed roles it is `tiers.<the role's tier>` in [`.agent/models.json`](../../../models.json). Never pass a model name of your own. Resuming (SendMessage) keeps the model of the first spawn.

## Resuming

Resume an Analyst, the Spec writer, the Coverage checker, the Prototyper or the Planner with SendMessage so it keeps what it read; the messages are in [resumes.md](resumes.md). If it can no longer be resumed, spawn a fresh one (an Analyst with `FRESH: lost`, or `resumed-run` when its area file does not exist; then `answers.md` starts empty).

In another harness, use its closest equivalent. If it cannot choose a model per subagent, spawn with its default. If it cannot resume a subagent, spawn a fresh one as above. If it cannot run subagents in parallel, run the four Analysts one after another; a round still ends when all of them have replied. With no Skill tool, add a line telling the subagent to read each named skill's `SKILL.md` instead.
