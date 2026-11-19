import type { AgentDto, AgentModelsDto, AgentModelsReason } from '@agentdesk/contracts';
import { agentModelsFixtures } from '../dto/agentModels';

/**
 * What `agents.models` answers for one agent. `ids` is the live list; `idsByBaseUrl` overrides it per saved API
 * address (the '' key is "no address"). `beforeCredentialSave` applies until a credential is saved for the agent.
 */
export type AgentModelsScenario = (
  | { kind: 'live'; ids: string[]; idsByBaseUrl?: Record<string, string[]> }
  | { kind: 'fallback'; reason: AgentModelsReason }
  | { kind: 'error' }
  | { kind: 'pending' }
) & { beforeCredentialSave?: AgentModelsScenario };

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
export function agentModelsAnswer(
  agent: AgentDto,
  scenario: AgentModelsScenario | undefined,
  credentialSaved: boolean,
): AgentModelsDto | 'error' | 'pending' {
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
      return fallbackOf[active.reason];
    case 'error':
      return 'error';
    case 'pending':
      return 'pending';
  }
}
