# claude-usage fixtures

Source: real Claude Code 2.1.323 session logs from a runner pod (main session file and the separate
`<session>/subagents/agent-*.jsonl` files, which is where sidechain calls are written). All ids, uuids, paths, session
ids, cwd and text are scrubbed; only the `usage` shapes are kept.

- `streaming-rows.jsonl`: real rows. `msg_01` is one call logged as three rows with one request id. The first row's
  output count (1, a streaming placeholder) was edited by hand; real logs repeat the final count.
- `retry-two-models.jsonl`: derived by editing one real row: a retry (new message and request ids) and a second model.
  Neither occurs in the recorded logs.
- `sidechain-and-edge.jsonl`: two real sidechain rows (from the subagent files); `<synthetic>` model, no usage, no
  request id and no `cache_creation` split are derived by editing real rows.
