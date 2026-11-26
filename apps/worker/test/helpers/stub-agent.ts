import type { AgentAdapter } from '@agentdesk/core';

const base: AgentAdapter = {
  kind: 'claude',
  builtinModels: [],
  credentialEnv: () => 'STUB_KEY',
  launchEnv: () => [],
  listModels: async () => [],
  checkConnection: async () => 'ok',
};

/** Priced under catalog provider `vendor-a` with the core default model key. */
export const pricedAgent: AgentAdapter = { ...base, pricing: { provider: 'vendor-a' } };

/** Priced under `vendor-a`, with a model key map that strips a `v-` prefix. */
export const customKeyAgent: AgentAdapter = {
  ...base,
  pricing: { provider: 'vendor-a', modelKey: (model) => model.replace(/^v-/, '') },
};

/** An adapter that declares no pricing. */
export const unpricedAgent: AgentAdapter = { ...base };
