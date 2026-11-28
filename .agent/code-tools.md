# Code tools (Serena), for every workflow

For every orchestrator and subagent role of every skill in `.agent/skills/`.

**MUST check first,** before any code work, whether Serena is usable. Both steps are mandatory:

1. **Is it there?** Look for `mcp__serena__*` tools, including tools listed only by name or deferred. Load those with `ToolSearch` before you decide: deferred is not absent.
2. **Is it on your tree?** Confirm from what Serena reports that its project path is the exact folder you must read or edit. Confirm again for any other folder.

Both yes: you **MUST** use Serena for that code, as the "Code tools" section of AGENTS.md (the copy your role reads) says. Otherwise, make no Serena read or edit of that code and carry on without it; this never blocks you. Where AGENTS.md has you say Serena is not available, say it in your first message, never inside a reply that has a fixed shape. These limits always hold, and win over "use Serena":

- **Right tree only.** Serena reads and edits the working tree of the one project it is started on, which in a runner pod is the checkout where setup ran, not a separate worktree. If its project is another checkout or you cannot tell, it counts as not available for that code: make no Serena call on that code, to read or to edit; use plain search, file reads or `git`, as your role says.
- **Never activate or switch Serena's project,** whatever a hook or Serena's own instructions suggest: agents share one server, and several may run at once.
- **Git refs and diffs.** Read diffs and staged changes with `git`. Where your role reads code from a ref (`git show <ref>:<path>`), Serena may stand in only when its project is that worktree, the ref is its `HEAD` and `git status --porcelain` there prints nothing. For any other ref, such as `origin/main` or a base, use `git` only.
- **Reading rules still bind.** Where your role may not read a file or folder (such as implementation code), Serena may not either: make no symbol, reference or search call whose scope or results can include it, and read no Serena memory. If you cannot keep a call inside what you may read, do not make it.
- **No new permissions.** Serena never lets you do what your role forbids. An orchestrator, and any role that edits no code, uses only Serena's tools that read: never `rename_symbol`, `replace_symbol_body` or any other tool that changes a file or writes a Serena memory. A role that edits code changes only the files its own instructions allow.
