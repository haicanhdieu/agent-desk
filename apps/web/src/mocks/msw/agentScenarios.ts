import type { AgentDto, AgentTestStatus } from '@agentdesk/contracts';
import type { RequestHandler } from 'msw';
import { agentsFixture, manyAgents } from '../dto/agents';
import { ids } from '../dto/ids';
import { ruleFixtures } from '../dto/rules';
import { mockDb } from './db';
import { problemResponse, routeHandler } from './http';

// Agent configuration scenarios (Agents tab of invoicer-api). Each one puts the project's agents in a known state and,
// where it bends an answer, sets store state or returns handler overrides, like the onboarding and platform scenarios.

const AGENT_SCENARIOS = [
  'agentsEmpty',
  'manyAgents',
  'listError',
  'deleteBlocked',
  'testRejected',
  'testUnreachable',
  'testInvalid',
  'testUnsupported',
  'opencodeEndpointModels',
  'swapDeleteFails',
  'perAgentModels',
] as const;

export type AgentScenario = (typeof AGENT_SCENARIOS)[number];

/** sessionStorage key the mocked e2e specs seed (e2e/mock/mock.ts `seedAgents`); browser.ts reads it once at start. */
export const AGENT_SCENARIO_KEY = 'agentdesk.mock.agentScenario';

/** The stored scenario name, or undefined when it is missing or unknown. */
export function parseAgentScenario(raw: string | null): AgentScenario | undefined {
  return AGENT_SCENARIOS.find((name) => name === raw);
}

const P = ids.project.invoicerApi;
const TEST_SCENARIOS: Partial<Record<AgentScenario, AgentTestStatus>> = {
  testRejected: 'rejected',
  testUnreachable: 'unreachable',
  testInvalid: 'invalid',
  testUnsupported: 'unsupported',
};

const idOf = (name: string): string => {
  const found = mockDb.state.agents.find((a) => a.projectId === P && a.name === name);
  if (!found) throw new Error(`agent scenario: fixture ${name} missing`);
  return found.id;
};

const fixture = (name: string): AgentDto => {
  const found = agentsFixture.find((a) => a.name === name);
  if (!found) throw new Error(`agent scenario: fixture ${name} missing`);
  return found;
};

/** The agents the project has in a scenario; the first is the default. A fresh copy: the store mutates its rows. */
const seedAgents = (rows = agentsFixture) => {
  mockDb.state.agents = [
    ...mockDb.state.agents.filter((a) => a.projectId !== P),
    ...structuredClone(rows).map((a) => ({ ...a, projectId: P })),
  ];
};

export function applyAgentScenario(name: AgentScenario): void {
  mockDb.state.agentTestScenario = TEST_SCENARIOS[name];
  mockDb.state.failPlaceholderDelete = name === 'swapDeleteFails';
  switch (name) {
    case 'agentsEmpty':
      seedAgents([]);
      return;
    case 'manyAgents':
      seedAgents(manyAgents(30));
      return;
    case 'deleteBlocked': {
      seedAgents();
      // "Claude - Work" is named by a rule (also counted in its usage); "Codex" has an open run.
      const workId = idOf('Claude - Work');
      const template = ruleFixtures[0];
      if (template) {
        mockDb.state.rules.push({ ...template, id: mockDb.nextId(), command: 'fix', agentId: workId });
      }
      const codex = mockDb.state.agents.find((a) => a.id === idOf('Codex'));
      const runTemplate = mockDb.state.runs[0];
      if (codex && runTemplate) {
        codex.usage = { rules: 0, blockingRuns: 1 };
        mockDb.state.runs.push({
          ...structuredClone(runTemplate),
          id: mockDb.nextId(),
          number: 900,
          status: 'paused',
          agent: { id: codex.id, name: codex.name, model: codex.model, provider: codex.provider },
        });
      }
      return;
    }
    case 'swapDeleteFails':
      // The wizard's placeholder: a credential-less default "Claude" next to the agent the wizard created.
      seedAgents([
        { ...fixture('Claude - New'), name: 'Claude', isDefault: false },
        { ...fixture('Codex'), isDefault: true },
      ]);
      return;
    case 'opencodeEndpointModels': {
      seedAgents();
      mockDb.state.agentModelScenarios[idOf('OpenCode - Own endpoint')] = {
        kind: 'live',
        ids: ['qwen3-coder', 'qwen3-coder-flash', 'llama-3.3-70b-instruct'],
      };
      return;
    }
    case 'perAgentModels':
      // Two agents with their own live lists; the others keep the default answers.
      seedAgents();
      mockDb.state.agentModelScenarios[idOf('Claude - Personal')] = {
        kind: 'live',
        ids: ['claude-opus-4-5', 'claude-sonnet-4-5'],
      };
      mockDb.state.agentModelScenarios[idOf('Codex')] = { kind: 'live', ids: ['gpt-5-codex', 'gpt-5-mini'] };
      return;
    case 'listError':
    case 'testRejected':
    case 'testUnreachable':
    case 'testInvalid':
    case 'testUnsupported':
      seedAgents();
  }
}

/** Handler overrides a scenario needs (the list answering 500). */
export function agentOverrides(name: AgentScenario): RequestHandler[] {
  if (name !== 'listError') return [];
  return [
    routeHandler('agents.list', async () =>
      problemResponse({ status: 500, title: 'Internal server error', type: 'internal' }),
    ),
  ];
}
