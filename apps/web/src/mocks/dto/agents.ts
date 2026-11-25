import type { AgentDto } from '@agentdesk/contracts';
import { agentListId, ids } from './ids';

// Mirrors mocks/agent.ts (DeskAgent): Claude on opus, 30 min timeout, OAuth token set by kim-hale on 12 Oct.
const agent = (id: string, projectId: string): AgentDto => ({
  id,
  projectId,
  name: 'Claude',
  provider: 'claude',
  model: 'opus',
  baseUrl: null,
  maxTurns: null,
  timeoutSeconds: 1800,
  pausedKeepSeconds: 604800,
  doneKeepSeconds: 86400,
  idleEndSeconds: 1800,
  autoResumeMax: 5,
  credential: { set: true, type: 'oauth_token', updatedAt: '2026-10-12T09:30:00.000Z', setBy: 'kim-hale' },
  accountLabel: null,
  isDefault: true,
  lastTest: null,
  usage: { rules: 0, blockingRuns: 0 },
});

export const agentFixtures: AgentDto[] = [
  agent(ids.agent.invoicerApi, ids.project.invoicerApi),
  agent(ids.agent.invoicerWeb, ids.project.invoicerWeb),
  agent(ids.agent.docsSite, ids.project.docsSite),
  agent(ids.agent.billingJobs, ids.project.billingJobs),
  agent(ids.agent.storefront, ids.project.storefront),
];

const limits = {
  timeoutSeconds: 86400,
  pausedKeepSeconds: 604800,
  doneKeepSeconds: 86400,
  idleEndSeconds: 1800,
  autoResumeMax: 5,
} as const;
const noCredential: AgentDto['credential'] = { set: false, type: null, updatedAt: null, setBy: null };
const saved = (type: NonNullable<AgentDto['credential']['type']>): AgentDto['credential'] => ({
  set: true,
  type,
  updatedAt: '2026-11-10T09:00:00.000Z',
  setBy: 'kim-hale',
});

const listAgent = (n: number, over: Partial<AgentDto>): AgentDto => ({
  id: agentListId(n),
  projectId: ids.project.invoicerApi,
  name: 'Agent',
  provider: 'claude',
  model: 'opus',
  baseUrl: null,
  maxTurns: null,
  ...limits,
  credential: saved('oauth_token'),
  accountLabel: null,
  isDefault: false,
  lastTest: { status: 'ok', at: '2026-11-11T10:00:00.000Z' },
  usage: { rules: 0, blockingRuns: 0 },
  ...over,
});

/** The agents of invoicer-api as the Agents tab lists them: every provider, credential type and status. */
export const agentsFixture: AgentDto[] = [
  listAgent(1, {
    name: 'Claude - Personal',
    accountLabel: 'kim@example.com',
    isDefault: true,
    usage: { rules: 4, blockingRuns: 1 },
  }),
  listAgent(2, {
    name: 'Claude - Work',
    accountLabel: 'Harbor Labs team',
    credential: saved('api_key'),
    lastTest: { status: 'rejected', at: '2026-11-12T09:30:00.000Z' },
    usage: { rules: 1, blockingRuns: 0 },
  }),
  listAgent(3, {
    name: 'Codex',
    provider: 'codex',
    model: 'gpt-5-codex',
    credential: saved('auth_json'),
    accountLabel: 'kim@example.com',
  }),
  listAgent(4, {
    name: 'OpenCode - Own endpoint',
    provider: 'opencode',
    model: 'qwen3-coder',
    baseUrl: 'https://llm.harbor-labs.example/v1',
    credential: saved('api_key'),
  }),
  listAgent(5, {
    name: 'OpenCode - Credentials file',
    provider: 'opencode',
    model: 'anthropic/claude-sonnet-4-5',
    credential: saved('auth_json'),
  }),
  listAgent(6, {
    name: 'OpenCode - No sign-in',
    provider: 'opencode',
    model: '',
    credential: noCredential,
    lastTest: null,
  }),
  listAgent(7, { name: 'Claude - New', credential: noCredential, lastTest: null }),
];

/** n agents for the long-list boards: the first is the default, names are unique. */
export const manyAgents = (n: number): AgentDto[] =>
  Array.from({ length: n }, (_, i) =>
    listAgent(100 + i, { name: `Agent ${String(i + 1).padStart(2, '0')}`, isDefault: i === 0 }),
  );
