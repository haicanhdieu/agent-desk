import { describe, expect, it } from 'vitest';
import { mapUsage as claudeMap } from '../agents/claude/transcript.mjs';
import { mapUsage as stubMap } from './stubs/subset-usage-agent.mjs';
import { expectConformingUsageMapper, usageCost } from './usage-conformance';

const claudeStyle = {
  type: 'assistant',
  requestId: 'req_c',
  message: {
    id: 'msg_c',
    model: 'claude-sonnet-5-5',
    usage: {
      input_tokens: 2048,
      cache_read_input_tokens: 1800,
      cache_creation_input_tokens: 248,
      cache_creation: { ephemeral_5m_input_tokens: 248, ephemeral_1h_input_tokens: 0 },
      output_tokens: 500,
    },
  },
};
const subsetStyle = {
  id: 'call_s',
  model: 'other-model',
  usage: {
    input_tokens: 4096,
    cached_input_tokens: 1800,
    cache_write_tokens: 248,
    output_tokens: 500,
    reasoning_tokens: 300,
  },
};

describe('usage mapper conformance', () => {
  it('Claude mapper gives the disjoint buckets', () => {
    expectConformingUsageMapper(claudeMap, { claudeStyle });
  });

  it('a subset-style agent mapper gives the same buckets and carries reasoning', () => {
    expectConformingUsageMapper(stubMap, { subsetStyle });
  });

  it('both cost the same at equal rates', () => {
    const a = expectConformingUsageMapper(claudeMap, { claudeStyle });
    const b = expectConformingUsageMapper(stubMap, { subsetStyle });
    expect(usageCost(a)).toBeCloseTo(usageCost(b), 12);
    expect(usageCost(a)).toBeGreaterThan(0);
  });
});
