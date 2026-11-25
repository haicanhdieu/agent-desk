import { queryOptions } from '@tanstack/react-query';
import { WHOLE_SET } from '@/app/pagination';
import { api } from '../api';
import { agentsKey, deskQueries } from '../desk/queries';

// Reads the setup steps need. Agent, skills and rules are the Desk's queries, so setup and the Desk share the cache.
export const setupQueries = {
  connections: (org: string) =>
    queryOptions({
      queryKey: ['org', org, 'connections'] as const,
      queryFn: () => api.connections.list(),
    }),
  repos: (org: string, connectionId: string) =>
    queryOptions({
      queryKey: ['org', org, 'connections', connectionId, 'repos'] as const,
      queryFn: () => api.connections.repos({ params: { connectionId } }),
    }),
  /**
   * The project's default agent, read from the agents list (the wizard never uses the single-agent compat route).
   * Under the agents prefix, so every agent write that invalidates the list refreshes it.
   */
  agent: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...agentsKey(org, projectId), 'default'] as const,
      queryFn: async () => {
        const { items } = await api.agents.list({ params: { projectId }, query: WHOLE_SET });
        const found = items.find((a) => a.isDefault) ?? items[0];
        if (!found) throw new Error('The project has no agent');
        return found;
      },
    }),
  skills: deskQueries.allSkills,
  rules: deskQueries.allRules,
};
