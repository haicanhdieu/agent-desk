import { queryOptions } from '@tanstack/react-query';
import type { PageQuery } from '@agentdesk/contracts';
import { WHOLE_SET } from '@/app/pagination';
import { api } from '../api';

const deskKey = (org: string, projectId: string) => ['org', org, 'projects', projectId, 'desk'] as const;

/** Prefix of every cached page of the skills list, the whole-set read included (invalidate with it). */
export const skillsKey = (org: string, projectId: string) => [...deskKey(org, projectId), 'skills'] as const;

/** Prefix of every cached page of the rules list, the whole-set read included (invalidate with it). */
export const rulesKey = (org: string, projectId: string) => [...deskKey(org, projectId), 'rules'] as const;

// Desk reads (spec §4.2). The setup flow reads agent, skills and rules through these too, so both share the cache.
export const deskQueries = {
  skills: (org: string, projectId: string, q: PageQuery) =>
    queryOptions({
      queryKey: [...skillsKey(org, projectId), q.page, q.pageSize] as const,
      queryFn: () => api.skills.list({ params: { projectId }, query: q }),
    }),
  /** Page 1 at the maximum size: for the readers that need every skill (the rule skill picker, setup checks, a skill off the page). */
  allSkills: (org: string, projectId: string) => deskQueries.skills(org, projectId, WHOLE_SET),
  skill: (org: string, projectId: string, name: string) =>
    queryOptions({
      queryKey: [...deskKey(org, projectId), 'skill', name] as const,
      queryFn: () => api.skills.get({ params: { projectId, name } }),
    }),
  rules: (org: string, projectId: string, q: PageQuery) =>
    queryOptions({
      queryKey: [...rulesKey(org, projectId), q.page, q.pageSize] as const,
      queryFn: () => api.rules.list({ params: { projectId }, query: q }),
    }),
  /** Page 1 at the maximum size: for the readers that need every rule (skill references, setup checks, a rule off the page). */
  allRules: (org: string, projectId: string) => deskQueries.rules(org, projectId, WHOLE_SET),
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
