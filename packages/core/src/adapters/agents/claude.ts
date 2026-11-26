import { z } from 'zod';
import { AgentBaseUrl, AgentModelId, type AgentModelOption, type CredentialType } from '@agentdesk/contracts';
import { guardedGetJson } from '../../net/guarded-http';
import { AgentModelsError, type AgentAdapter, type AgentHttpGet } from './types';

export const CLAUDE_DEFAULT_BASE_URL = 'https://api.anthropic.com';

const MAX_PAGES = 5;
/** One budget for the whole list, all pages together. */
export const LIST_TIMEOUT_MS = 5000;

const ModelsPage = z.object({
  data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })),
  has_more: z.boolean().optional(),
  last_id: z.string().nullish(),
});

const defaultHttp: AgentHttpGet = (url, headers, opts) => guardedGetJson(url, { headers, ...opts });

function requestHeaders(credential: { type: CredentialType; value: string }): Record<string, string> {
  const base = { 'anthropic-version': '2023-06-01' };
  return credential.type === 'api_key'
    ? { ...base, 'x-api-key': credential.value }
    : { ...base, authorization: `Bearer ${credential.value}`, 'anthropic-beta': 'oauth-2025-04-20' };
}

/** `<base>` with trailing slashes stripped from its path, plus `/v1/models` and the paging query. */
function pageUrl(baseUrl: string, afterId: string | null): URL {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/v1/models`;
  url.search = '';
  url.hash = '';
  url.searchParams.set('limit', '1000');
  if (afterId !== null) url.searchParams.set('after_id', afterId);
  return url;
}

export function createClaudeAdapter(http: AgentHttpGet = defaultHttp): AgentAdapter {
  const adapter: AgentAdapter = {
    kind: 'claude',
    pricing: { provider: 'anthropic' },
    builtinModels: ['opus', 'sonnet', 'haiku'].map((id) => ({ id, label: id })),
    credentialEnv: (type) => (type === 'oauth_token' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'),
    launchEnv: ({ model, baseUrl }) => [
      { name: 'AGENT', value: 'claude' },
      ...(model !== ''
        ? [
            { name: 'AGENT_MODEL', value: model },
            { name: 'ANTHROPIC_MODEL', value: model },
          ]
        : []),
      ...(baseUrl ? [{ name: 'ANTHROPIC_BASE_URL', value: baseUrl }] : []),
    ],
    async listModels({ credential, baseUrl }) {
      // An address the contract would refuse never gets a request (defense in depth behind the API's validation).
      if (baseUrl !== null && !AgentBaseUrl.safeParse(baseUrl).success) throw new AgentModelsError('unreachable');
      const headers = requestHeaders(credential);
      const seen = new Set<string>();
      const models: AgentModelOption[] = [];
      let afterId: string | null = null;
      const deadline = Date.now() + LIST_TIMEOUT_MS;
      for (let page = 0; page < MAX_PAGES; page++) {
        const left = deadline - Date.now();
        if (left <= 0) throw new AgentModelsError('unreachable');
        let res: { status: number; json: unknown };
        try {
          res = await http(pageUrl(baseUrl ?? CLAUDE_DEFAULT_BASE_URL, afterId), headers, { timeoutMs: left });
        } catch {
          // Any transport failure (guarded refusal, redirect, timeout, network, bad address) reads as unreachable; the cause is dropped on purpose.
          throw new AgentModelsError('unreachable');
        }
        if (res.status === 401 || res.status === 403) throw new AgentModelsError('rejected');
        if (res.status < 200 || res.status >= 300) throw new AgentModelsError('invalid');
        const parsed = ModelsPage.safeParse(res.json);
        if (!parsed.success) throw new AgentModelsError('invalid');
        for (const m of parsed.data.data) {
          // The contract trims ids, so the trimmed value is the model; keep that one everywhere.
          const id = AgentModelId.safeParse(m.id);
          if (!id.success || seen.has(id.data)) continue;
          seen.add(id.data);
          models.push({ id: id.data, label: m.display_name ?? id.data });
        }
        const next = parsed.data.last_id;
        if (!parsed.data.has_more || !next) break;
        afterId = next;
      }
      return models;
    },
    async checkConnection({ credential, baseUrl }) {
      if (credential === null) return 'unsupported';
      try {
        await adapter.listModels({ credential, baseUrl });
        return 'ok';
      } catch (e) {
        // Only the status word leaves; an unexpected error (for example a bad address) reads as unreachable.
        return e instanceof AgentModelsError ? e.kind : 'unreachable';
      }
    },
  };
  return adapter;
}
