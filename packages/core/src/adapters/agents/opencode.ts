import { AgentBaseUrl } from '@agentdesk/contracts';
import { guardedGetJson } from '../../net/guarded-http';
import { fetchBearerModelList, statusOf } from './models-http';
import { AgentModelsError, type AgentAdapter, type AgentHttpGet } from './types';

const defaultHttp: AgentHttpGet = (url, headers, opts) => guardedGetJson(url, { headers, ...opts });

/** The custom provider id; the run selects `agentdesk/<modelId>`. */
const PROVIDER_ID = 'agentdesk';
const KEY_ENV = 'AGENTDESK_LLM_API_KEY';

// Built-in names from the Task 5 spike (packages/core/test/fixtures/agents/opencode/spike.json); each is provider-prefixed.
const BUILTIN = [
  { id: 'opencode/big-pickle', label: 'Big Pickle (free)' },
  { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash (free)' },
  { id: 'opencode/qwen4-max-free', label: 'Qwen4 Max (free)' },
  { id: 'opencode/nemotron-3.5-super-vl-free', label: 'Nemotron 3.5 Super VL (free)' },
];

/** The inline config: one custom provider for the run's frozen model. Built with JSON.stringify only; the key is never in it. */
function inlineConfig(baseUrl: string, model: string): string {
  return JSON.stringify({
    provider: {
      [PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Agent Desk',
        options: { baseURL: baseUrl },
        env: [KEY_ENV],
        models: model === '' ? {} : Object.fromEntries([[model, { name: model }]]),
      },
    },
  });
}

/** `<base>/models`, or null for an address the contract would refuse (not public https, credentials, query, over 2048 characters). */
function modelsUrl(baseUrl: string | null): URL | null {
  const parsed = AgentBaseUrl.safeParse(baseUrl);
  if (!parsed.success) return null;
  const url = new URL(parsed.data);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`;
  return url;
}

export function createOpencodeAdapter(http: AgentHttpGet = defaultHttp): AgentAdapter {
  const adapter: AgentAdapter = {
    kind: 'opencode',
    builtinModels: BUILTIN,
    // auth_json is imported with `opencode auth import`, not an env var.
    credentialEnv: (type) => (type === 'api_key' ? KEY_ENV : null),
    launchEnv: ({ model, baseUrl, credentialType }) => {
      // The agentdesk/ prefix names the inline provider, so it applies only when that config is emitted.
      const inline = credentialType === 'api_key' && !!baseUrl;
      return [
        { name: 'AGENT', value: 'opencode' },
        { name: 'OPENCODE_DISABLE_AUTOUPDATE', value: '1' },
        ...(model !== '' ? [{ name: 'AGENT_MODEL', value: inline ? `${PROVIDER_ID}/${model}` : model }] : []),
        ...(inline && baseUrl ? [{ name: 'OPENCODE_CONFIG_CONTENT', value: inlineConfig(baseUrl, model) }] : []),
      ];
    },
    async listModels({ credential, baseUrl }) {
      if (credential.type !== 'api_key') return [...BUILTIN];
      const url = modelsUrl(baseUrl);
      if (url === null) throw new AgentModelsError('unreachable');
      return fetchBearerModelList(http, url, credential.value);
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
