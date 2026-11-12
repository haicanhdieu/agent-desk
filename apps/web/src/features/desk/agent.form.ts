import type { AgentDto, CredentialType, ProjectDto, UpdateProjectRequest } from '@agentdesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { AgentSettings } from '@/mocks/types';
import type { AgentLimits, LimitField } from '@/screens';
import { api } from '../api';
import { projectsQueries } from '../projects/queries';
import { relativeTime } from '../relativeTime';
import { fieldErrorsFromProblem } from './problem';
import { deskQueries } from './queries';

// Desk, Agent & settings (spec §4.3): limits and the credential. Trigger mode and delete are in mutations.ts.

/**
 * The idle timeout is fixed on the server (10 min, control-plane spec §5) and no contract field carries it, so the
 * field shows the server's value read-only and a save never sends it (CONTRACT-GAPS.md).
 */
export const IDLE_END_MINUTES = 10;

/** The Agent & settings screen's view of the agent and project. Pass `useNow()`. */
export function toAgentSettings(agent: AgentDto, project: ProjectDto, now: Date): AgentSettings {
  const { credential } = agent;
  return {
    agent: 'Claude',
    model: agent.model,
    credential: {
      type: credential.type ?? 'oauth_token',
      // Empty when no credential is set: the screen then shows no "Set … by …" line.
      setAt: credential.set && credential.updatedAt ? relativeTime(credential.updatedAt, now) : '',
      setBy: credential.setBy ?? '',
    },
    ...limitsOf(agent, project),
  };
}

export function limitsOf(agent: AgentDto, project: ProjectDto): AgentLimits {
  return {
    timeoutMinutes: Math.round(agent.timeoutSeconds / 60),
    idleEndMinutes: IDLE_END_MINUTES,
    maxConcurrent: project.maxConcurrentRuns,
    maxRunsPerTicket: project.maxRunsPerTicket,
  };
}

export interface LimitsRequests {
  project?: Pick<UpdateProjectRequest, 'maxConcurrentRuns' | 'maxRunsPerTicket'>;
  timeoutSeconds?: number;
}

/**
 * What a limits save sends: only the fields changed since `base` (what the form opened with, or last saved), so a
 * limit changed elsewhere meanwhile is not overwritten. Minutes become seconds for the agent. The idle limit is never
 * compared or sent (see `IDLE_END_MINUTES`).
 */
export function limitsRequests(base: AgentLimits, next: AgentLimits): LimitsRequests {
  const changed = (k: LimitField) => !Object.is(base[k], next[k]);
  const project = {
    ...(changed('maxConcurrent') && { maxConcurrentRuns: next.maxConcurrent }),
    ...(changed('maxRunsPerTicket') && { maxRunsPerTicket: next.maxRunsPerTicket }),
  };
  return {
    ...(Object.keys(project).length > 0 && { project }),
    ...(changed('timeoutMinutes') && { timeoutSeconds: Math.round(next.timeoutMinutes * 60) }),
  };
}

/** problem+json pointers of the two limit requests → the screen's limit fields. */
export const LIMIT_POINTERS: Record<string, LimitField> = {
  '/timeoutSeconds': 'timeoutMinutes',
  '/maxConcurrentRuns': 'maxConcurrent',
  '/maxRunsPerTicket': 'maxRunsPerTicket',
};

const LIMIT_FIELDS: ReadonlySet<string> = new Set(Object.values(LIMIT_POINTERS));
const isLimitField = (k: string): k is LimitField => LIMIT_FIELDS.has(k);

/** True when a limits save has something to send. */
export const hasLimitChanges = (req: LimitsRequests): boolean =>
  req.project !== undefined || req.timeoutSeconds !== undefined;

/**
 * Saves the limits: `projects.update` for the run limits and `agents.put` for the timeout, in parallel. `agents.put`
 * replaces the agent, so its other fields come from the agent fetched right before the write. Field messages come
 * from the problem pointers; one save at a time.
 */
export function useSaveLimits(org: string, projectId: string, initial: AgentLimits, { onSaved }: { onSaved(): void }) {
  const qc = useQueryClient();
  const base = useRef(initial);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<LimitField, string>>>({});
  const [formError, setFormError] = useState<string>();

  const saveProject = async (body: NonNullable<LimitsRequests['project']>) => {
    const saved = await api.projects.update({ params: { projectId }, body });
    qc.setQueryData(projectsQueries.detail(org, projectId).queryKey, saved);
    base.current = {
      ...base.current,
      maxConcurrent: saved.maxConcurrentRuns,
      maxRunsPerTicket: saved.maxRunsPerTicket,
    };
  };
  const saveTimeout = async (timeoutSeconds: number) => {
    const agent = await qc.fetchQuery({ ...deskQueries.agent(org, projectId), staleTime: 0 });
    const saved = await api.agents.put({
      params: { projectId },
      body: { model: agent.model, timeoutSeconds, ...(agent.maxTurns !== null && { maxTurns: agent.maxTurns }) },
    });
    qc.setQueryData(deskQueries.agent(org, projectId).queryKey, saved);
    base.current = { ...base.current, timeoutMinutes: Math.round(saved.timeoutSeconds / 60) };
  };

  const save = async (next: AgentLimits) => {
    if (inFlight.current) return;
    const requests = limitsRequests(base.current, next);
    // Nothing changed since the last save: nothing to send and nothing to confirm.
    if (!hasLimitChanges(requests)) return;
    inFlight.current = true;
    setSaving(true);
    setErrors({});
    setFormError(undefined);
    try {
      const { project, timeoutSeconds } = requests;
      const results = await Promise.allSettled([
        project && saveProject(project),
        timeoutSeconds !== undefined && saveTimeout(timeoutSeconds),
      ]);
      const fields: Partial<Record<LimitField, string>> = {};
      const forms: string[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') continue;
        const problem = fieldErrorsFromProblem(r.reason, LIMIT_POINTERS);
        // The problem's fields are keyed by the map's values, i.e. limit fields.
        for (const [k, v] of Object.entries(problem.fields)) if (isLimitField(k)) fields[k] ??= v;
        if (problem.form) forms.push(problem.form);
      }
      if (project) void qc.invalidateQueries({ queryKey: projectsQueries.list(org).queryKey, exact: true });
      setErrors(fields);
      setFormError(forms.length > 0 ? forms.join(' ') : undefined);
      if (results.every((r) => r.status === 'fulfilled')) onSaved();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return { save, saving, errors, formError };
}

/** Pointers of a refused credential → the token input. */
const CREDENTIAL_POINTERS: Record<string, string> = { '/value': 'credential', '/type': 'credential' };

/**
 * Replaces the agent's credential. Not a Query mutation on purpose: mutation variables live in the mutation cache,
 * and the token must not be kept anywhere after the request (spec §4.3: write-only, never cached). Resolves `true`
 * when saved; the agent query refetches to show who set it and when.
 */
export function useReplaceCredential(org: string, projectId: string, agentId: string) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const replace = async (type: CredentialType, value: string): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      await api.agents.putCredential({ params: { agentId }, body: { type, value } });
      await qc.invalidateQueries({ queryKey: deskQueries.agent(org, projectId).queryKey });
      return true;
    } catch (e) {
      const problem = fieldErrorsFromProblem(e, CREDENTIAL_POINTERS);
      setError(problem.fields.credential ?? problem.form);
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  return { replace, pending, error };
}
