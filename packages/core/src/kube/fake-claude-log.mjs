// Builders for the Claude Code JSONL session log the fake pod keeps on its fake volume, in the shapes the runner's
// transcript adapter (images/runner/agents/claude/transcript.mjs) reads. Pure except `appendEntry`.
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const base = () => ({ uuid: randomUUID(), timestamp: new Date().toISOString() });

/** A typed or initial prompt. @param {string} text */
export const userEntry = (text) => ({ type: 'user', ...base(), message: { role: 'user', content: text } });

/** A tool output the adapter must not forward. @param {string} text */
export const toolResultEntry = (text) => ({
  type: 'user',
  ...base(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake', content: text }] },
});

/**
 * An assistant entry with one text block. `thinking` adds a thinking block before it, `tools` appends tool_use blocks
 * ({ name, input }), and `apiError` marks it as an API error message.
 * @param {string} text
 * @param {{ thinking?: string; tools?: { name: string; input: Record<string, unknown> }[]; apiError?: boolean }} [opts]
 */
export function replyEntry(text, { thinking, tools, apiError } = {}) {
  const content = [];
  if (thinking !== undefined) content.push({ type: 'thinking', thinking });
  content.push({ type: 'text', text });
  for (const t of tools ?? [])
    content.push({ type: 'tool_use', id: `toolu_${randomUUID()}`, name: t.name, input: t.input });
  return {
    type: 'assistant',
    ...base(),
    ...(apiError ? { isApiErrorMessage: true } : {}),
    message: { role: 'assistant', content },
  };
}

/** @param {string} file @param {object} entry */
export const appendEntry = (file, entry) => appendFileSync(file, `${JSON.stringify(entry)}\n`);

/**
 * A Claude-shaped assistant entry that carries token usage: one text block, `requestId`, `message.id`,
 * `message.model` and `message.usage` with the `cache_creation` split. Writing the same ids twice with a larger
 * `output` is how a streaming placeholder row followed by its final row looks in the real log.
 * @param {{ messageId: string; requestId: string; model: string; input: number; output: number; cacheRead?: number; cacheCreation5m?: number; cacheCreation1h?: number }} u
 */
export function usageEntry({
  messageId,
  requestId,
  model,
  input,
  output,
  cacheRead = 0,
  cacheCreation5m = 0,
  cacheCreation1h = 0,
}) {
  return {
    type: 'assistant',
    ...base(),
    requestId,
    message: {
      id: messageId,
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'Fake usage call' }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreation5m + cacheCreation1h,
        cache_creation: { ephemeral_5m_input_tokens: cacheCreation5m, ephemeral_1h_input_tokens: cacheCreation1h },
      },
    },
  };
}
