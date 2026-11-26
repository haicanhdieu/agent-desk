import {
  AGENT_KIND_CAPABILITIES,
  type AgentDto,
  type AgentModelsDto,
  type AgentModelsReason,
} from '@agentdesk/contracts';
import { agentModelsFixtures } from '../dto/agentModels';

/**
 * What `agents.models` answers for one agent. `ids` is the live list; `idsByBaseUrl` overrides it per saved API
 * address (the '' key is "no address"). `beforeCredentialSave` applies until a credential is saved for the agent.
 */
export type AgentModelsScenario = (
  | { kind: 'live'; ids: string[]; idsByBaseUrl?: Record<string, string[]> }
  // `providerText` is what the provider said about the failure. It rides along in an extra `error` field outside the
  // contract (AgentModelsDto ignores it), so a spec can prove the screen never shows provider text (BR-3).
  | { kind: 'fallback'; reason: AgentModelsReason; providerText?: string }
  | { kind: 'error' }
  | { kind: 'pending' }
) & { beforeCredentialSave?: AgentModelsScenario };

/** The answer of `agents.models`: the contract DTO, plus the provider's error text a fallback scenario can carry. */
export type AgentModelsAnswer = AgentModelsDto & { error?: { type: string; message: string } };

/** The mocked e2e specs put the scenarios per agent id here (sessionStorage), read once by browser.ts at start. */
export const AGENT_MODELS_SCENARIO_KEY = 'agentdesk.mock.agentModels';

const fallbackOf: Record<AgentModelsReason, AgentModelsDto> = {
  no_credential: agentModelsFixtures.noCredential,
  unreachable: agentModelsFixtures.unreachable,
  rejected: agentModelsFixtures.rejected,
  empty: agentModelsFixtures.empty,
  disabled: agentModelsFixtures.disabled,
};

/**
 * Default: no credential gives builtin/no_credential, a credential gives the live fixture. Only a live scenario
 * still answers no_credential while the agent has none; fallback, error and pending apply regardless. `credentialSaved` is whether a credential was saved for the agent
 * since the store was seeded (it ends `beforeCredentialSave`).
 */
function scenarioAnswer(
  agent: AgentDto,
  scenario: AgentModelsScenario | undefined,
  credentialSaved: boolean,
): AgentModelsAnswer | 'error' | 'pending' {
  const active = !credentialSaved && scenario?.beforeCredentialSave ? scenario.beforeCredentialSave : scenario;
  // Only the default and a live list need a credential; fallback, error and pending apply either way.
  if (!active) return agent.credential.set ? agentModelsFixtures.live : agentModelsFixtures.noCredential;
  if (active.kind === 'live' && !agent.credential.set) return agentModelsFixtures.noCredential;
  switch (active.kind) {
    case 'live': {
      const ids = active.idsByBaseUrl?.[agent.baseUrl ?? ''] ?? active.ids;
      return { source: 'live', reason: null, models: ids.map((id) => ({ id, label: id })) };
    }
    case 'fallback':
      return active.providerText === undefined
        ? fallbackOf[active.reason]
        : { ...fallbackOf[active.reason], error: { type: 'authentication_error', message: active.providerText } };
    case 'error':
      return 'error';
    case 'pending':
      return 'pending';
  }
}

/** The answer of `agents.models`. A built-in answer lists the standard names of the agent's own provider. */
export function agentModelsAnswer(
  agent: AgentDto,
  scenario: AgentModelsScenario | undefined,
  credentialSaved: boolean,
): AgentModelsAnswer | 'error' | 'pending' {
  const answer = scenarioAnswer(agent, scenario, credentialSaved);
  if (typeof answer === 'string' || answer.source !== 'builtin') return answer;
  return { ...answer, models: AGENT_KIND_CAPABILITIES[agent.provider].builtinModels };
}
