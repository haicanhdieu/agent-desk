import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';
import { deskQueries } from '../desk/queries';

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
  agent: deskQueries.agent,
  skills: deskQueries.skills,
  rules: deskQueries.rules,
};
