// Test stub of a second agent whose log reports usage the "subset" way: `input` already contains the cached and the
// cache-written tokens, and `output` already contains the reasoning tokens. Its mapper must still print disjoint
// buckets. Not shipped in the runner image.

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * @param {unknown} raw `{ id, model, usage: { input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, reasoning_tokens } }`
 * @returns {{ id: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWriteLongTokens: number; reasoningTokens: number } | undefined}
 */
export function mapUsage(raw) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.model !== 'string' || !isRecord(raw.usage))
    return undefined;
  const u = raw.usage;
  const n = (/** @type {unknown} */ x) => (typeof x === 'number' ? x : 0);
  const cacheRead = n(u.cached_input_tokens);
  const cacheWrite = n(u.cache_write_tokens);
  return {
    id: raw.id,
    model: raw.model,
    inputTokens: n(u.input_tokens) - cacheRead - cacheWrite,
    outputTokens: n(u.output_tokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    cacheWriteLongTokens: 0,
    reasoningTokens: n(u.reasoning_tokens),
  };
}
