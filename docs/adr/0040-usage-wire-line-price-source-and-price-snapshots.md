# 0040. Agent-neutral usage wire line, a pluggable price-source adapter and a price snapshot per usage entry

- Status: Accepted
- Date: 2026-11-24
- Source: [Run token usage, models and estimated cost design](../superpowers/specs/2026-11-24-run-token-usage-cost-design.md) (Contracts, Data model, Other decisions, ADR); [plan](../superpowers/plans/2026-11-24-run-token-usage-cost.md) Task 15; GitHub issue #248

## Context

Runs show no token use or cost. The agent's session log already leaves the pod through the transcript channel ([0027](0027-agent-neutral-transcript-protocol.md)), and the agent adapter already owns model names and routing ([0026](0026-agent-adapters-for-models-and-endpoint.md)). Usage must stay agent-neutral ([0005](0005-provider-agnostic-naming-adapter-seams.md)), the cost of a finished call must not change when prices change later, and the price list must come from a replaceable source that can be fetched safely from outside the cluster.

## Decision

1. **Usage wire line (amends 0027).** An agent adapter's `transcript.mjs` may print `agentdesk: usage <base64>` lines in the same read pass as its transcript lines, one line per model call. The adapter owns the agent's log format, the call id, the model and the token mapping. An agent with no `transcript.mjs`, or no usage in its log, prints none and the run reads `usage: null`.
2. **Disjoint buckets and the total.** Counters never overlap: `inputTokens` is uncached input only, `cacheReadTokens`, `cacheWriteTokens` (standard lifetime) and `cacheWriteLongTokens` (extended lifetime) are separate, and `outputTokens` is all output. `reasoningTokens` is an informational subset of output, never added to the total and never priced separately. `totalTokens = input + cacheRead + cacheWrite + output` (cache write includes the long kind). Each adapter normalises to these buckets. The wire schema rejects unknown keys, so a line can never carry a price; counts are non-negative integers, at most 100,000,000. Limits: `USAGE_WIRE_MAX_BASE64 = 1000`, `USAGE_ENTRY_CAP = 20000` distinct ids per run.
3. **Price snapshot per usage entry.** Rows in `run_usage_entries` are keyed `(run_id, source_id)`. The five rates, `price_as_of` (the `checked_at` of the version used), `price_source` and `price_version_id` are copied onto the row when it is first recorded, all from one version, and are never re-applied. A replay or a later row only raises the token counters (`GREATEST`); the model and every price column are not in the update list. A model with no price when recorded keeps null prices forever and the run shows `partial`, even if a later sync adds that model.
4. **`PriceSource` port (extends 0026).** The agent adapter names only `pricing: { provider, modelKey }`; it holds no prices. Rates come from `PriceSource { kind; fetchPrices({ providers }) }` returning neutral records in USD per million tokens. A `createPriceSourceRegistry(config)` picks the adapter by `MODEL_PRICES_SOURCE`, as the adapter registry does. The first adapter is `litellm` (the public LiteLLM price JSON, fetched with `guardedGetJson`, 15,000,000 bytes and 30 s limits, request host asserted equal to the host of the configured URL). A `fake` adapter serves dev and tests. Adding another source is one adapter file, one registry case and one enum value; the sink, activity, tables, API and web do not change.
5. **Catalog validation and change guards (source-agnostic, in core).** After the adapter returns, every record is re-validated (slug and model key charset 1..128, rates finite and within 0..1000 USD per million tokens), keys normalised, duplicates dropped (last wins). Guards reject the whole sync, keep the current version and fail the activity at `error` level when: (a) more than 5 percent of entries present in both versions moved by more than 5x in any rate, (b) the record count drops more than 20 percent, or (c) zero records match. They are skipped for the first version and once after a source change. Thresholds are constants with tests.
6. **Sync schedule.** Temporal Schedule `price-sync` (`PRICE_SYNC_SCHEDULE_ID`) runs every 6 hours with overlap SKIP and triggers immediately on creation. It starts workflow `PriceSyncWorkflow` (`WORKFLOW.priceSync`), which makes one call to activity `syncModelPrices` (start-to-close 120 s, at most 5 attempts). A sync that finds the same rates only moves `checked_at`; changed rates, or a different source, insert a new version and flip `is_current` in one transaction. Nothing is ever deleted.
7. **Org-less price tables.** `model_price_versions` and `model_prices` carry no `org_id` and have no RLS. This is a documented exception to `withOrg`, like `role_templates` and `platform_admins`; only the worker reads or writes them. `model_prices` rows are immutable (grants: SELECT, INSERT). `docs/conventions/database.md` §2 lists them. `run_usage_entries` is org-scoped with RLS.
8. **Configuration.** `MODEL_PRICES_SOURCE` is `litellm` (default), `fake` or `off`; `fake` is rejected when `NODE_ENV=production`; `off` means no sync and every entry is unpriced. `MODEL_PRICES_URL` replaces the adapter's default URL; it must be a valid `https:` URL with no username, password or fragment and at most 2048 characters, and is ignored by `fake` and `off`. Both are operator settings read through the config only, never from a request, tenant record, ticket or repo.
9. **Accepted risk: forged lines.** The agent shares the container and can print a forged usage line into its own run, as 0020 and 0027 accept for status and transcript lines. The impact stays in that run, is bounded by the per-run cap, the figure is labelled an estimate, and a line cannot set rates.

## Alternatives considered

- **Other price sources.** OpenRouter and models.dev were considered and left as later adapters behind the same port. A static list in code needs a release for every price change. The human chose one live source, LiteLLM's public JSON, synced on a schedule.
- **Other usage channels.** Agent telemetry exporters need a collector service. One-shot JSON output cost does not fit interactive tmux runs ([0011](0011-interactive-claude-code-in-tmux.md)). Statusline JSON is not reachable from hooks. Scraping the terminal is fragile.
- **Re-pricing at read time with the current price list.** Rejected: a recorded run's cost would change after each price change.

## Consequences

### Positive

- A run's cost is stable and auditable: each entry keeps the rates, date and source it was priced with.
- New agents and new price sources are adapter-only changes.
- Recording never waits on the network; the price fetch is one guarded, bounded request by the worker.

### Negative

- Cost is an estimate: tiered (above 200k tokens) and batch rates are ignored, and the sink caches the current version for up to 5 minutes.
- A model missing from the price list when called stays unpriced and the run is marked partial.
- A forged usage line can distort the figures of its own run.
- The worker needs outbound HTTPS to the price host (`raw.githubusercontent.com` by default).

## Links

- [Source spec](../superpowers/specs/2026-11-24-run-token-usage-cost-design.md)
- Related ADRs: [0005](0005-provider-agnostic-naming-adapter-seams.md), [0011](0011-interactive-claude-code-in-tmux.md), [0026](0026-agent-adapters-for-models-and-endpoint.md), [0027](0027-agent-neutral-transcript-protocol.md)
