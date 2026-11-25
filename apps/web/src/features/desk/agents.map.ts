import type { AgentDto } from '@agentdesk/contracts';
import { agentRowView } from '@/mocks/agent';
import type { AgentRowView } from '@/mocks/types';

/** One row of the Agents list, built from the DTO and the contracts capability table (names are text, never markup). */
export function toAgentRowView(agent: AgentDto): AgentRowView {
  return agentRowView(agent);
}
