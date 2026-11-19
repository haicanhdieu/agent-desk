import { queryOptions } from '@tanstack/react-query';
import { api } from '../api';

const deskKey = (org: string, projectId: string) => ['org', org, 'projects', projectId, 'desk'] as const;

// Desk reads (spec §4.2). The setup flow reads agent, skills and rules through these too, so both share the cache.
export const deskQueries = {
  skills: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'skills'] as const,
      queryFn: () => api.skills.list({ params: { projectId } }),
    }),
  skill: (org: string, projectId: string, name: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'skill', name] as const,
      queryFn: () => api.skills.get({ params: { projectId, name } }),
    }),
  rules: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'rules'] as const,
      queryFn: () => api.rules.list({ params: { projectId } }),
    }),
  // The lines Agent Desk appends to a custom prompt change only with a deploy or the repo path.
  promptPreview: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'promptPreview'] as const,
      queryFn: () => api.rules.promptPreview({ params: { projectId } }),
      staleTime: Infinity,
    }),
  agent: (org: string, projectId: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'agent'] as const,
      queryFn: () => api.agents.get({ params: { projectId } }),
    }),
  // Keyed by agent id only (never by credential or address), so one agent's list is never shown for another. The
  // list changes only with the agent's credential or address, which invalidate it; five minutes spares the provider.
  agentModels: (org: string, agentId: string) =>
    queryOptions({
      queryKey: ['org', org, 'agents', agentId, 'models'] as const,
      queryFn: () => api.agents.models({ params: { agentId } }),
      staleTime: 5 * 60_000,
    }),
};
