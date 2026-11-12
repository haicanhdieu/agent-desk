import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';

const deskKey = (org: string, projectId: string) => ['org', org, 'projects', projectId, 'desk'] as const;

// Reads the setup steps need. Agent, skills and rules use the desk keys of spec §4.2 so the desk shares the cache.
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
  agent: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'agent'] as const,
      queryFn: () => api.agents.get({ params: { projectId } }),
    }),
  skills: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'skills'] as const,
      queryFn: () => api.skills.list({ params: { projectId } }),
    }),
  rules: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'rules'] as const,
      queryFn: () => api.rules.list({ params: { projectId } }),
    }),
};
