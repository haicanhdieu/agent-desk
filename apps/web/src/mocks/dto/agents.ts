import type { AgentDto } from '@agentdesk/contracts';
import { ids } from './ids';

// Mirrors mocks/agent.ts (DeskAgent): Claude on opus, 30 min timeout, OAuth token set by kim-hale on 12 Oct.
const agent = (id: string, projectId: string): AgentDto => ({
  id,
  projectId,
  name: 'Claude',
  provider: 'claude',
  model: 'opus',
  maxTurns: null,
  timeoutSeconds: 1800,
  credential: { set: true, type: 'oauth_token', updatedAt: '2026-10-12T09:30:00.000Z', setBy: 'kim-hale' },
});

export const agentFixtures: AgentDto[] = [
  agent(ids.agent.invoicerApi, ids.project.invoicerApi),
  agent(ids.agent.invoicerWeb, ids.project.invoicerWeb),
  agent(ids.agent.docsSite, ids.project.docsSite),
  agent(ids.agent.billingJobs, ids.project.billingJobs),
  agent(ids.agent.storefront, ids.project.storefront),
];
