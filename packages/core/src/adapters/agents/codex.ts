import { guardedGetJson } from '../../net/guarded-http';
import { fetchBearerModelList, statusOf } from './models-http';
import type { AgentAdapter, AgentHttpGet } from './types';

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

const defaultHttp: AgentHttpGet = (url, headers, opts) => guardedGetJson(url, { headers, ...opts });

// Built-in names from the Task 5 spike (packages/core/test/fixtures/agents/codex/spike.json).
const BUILTIN = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'gpt-5.5', label: 'GPT-5.5 (API key only)' },
];

export function createCodexAdapter(http: AgentHttpGet = defaultHttp): AgentAdapter {
  const adapter: AgentAdapter = {
    kind: 'codex',
    builtinModels: BUILTIN,
    // auth_json is delivered as $CODEX_HOME/auth.json, not an env var.
    credentialEnv: (type) => (type === 'api_key' ? 'CODEX_API_KEY' : null),
    // Codex has no address field: the address is never read.
    launchEnv: ({ model }) => [
      { name: 'AGENT', value: 'codex' },
      ...(model !== '' ? [{ name: 'AGENT_MODEL', value: model }] : []),
    ],
    async listModels({ credential }) {
      // A sign-in file has no API scope, so there is nothing to ask.
      if (credential.type !== 'api_key') return [...BUILTIN];
      return fetchBearerModelList(http, new URL(OPENAI_MODELS_URL), credential.value);
    },
    async checkConnection({ credential, baseUrl }) {
      if (credential === null || credential.type !== 'api_key') return 'unsupported';
      try {
        await adapter.listModels({ credential, baseUrl });
        return 'ok';
      } catch (e) {
        return statusOf(e);
      }
    },
  };
  return adapter;
}
