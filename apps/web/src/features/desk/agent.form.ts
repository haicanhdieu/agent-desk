import type { AgentDto, CredentialType, ProjectDto, UpdateProjectRequest } from '@agentdesk/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { AgentSettings } from '@/mocks/types';
import type { AgentLimits, LimitField } from '@/screens';
import { api } from '../api';
import { projectsListKey, projectsQueries } from '../projects/queries';
import { relativeTime } from '../relativeTime';
import { fieldErrorsFromProblem } from './problem';
import { deskQueries } from './queries';

// Desk, Agent & settings (spec §4.3): limits and the credential. Trigger mode and delete are in mutations.ts.

/** The Agent & settings screen's view of the agent and project. Pass `useNow()`. */
export function toAgentSettings(agent: AgentDto, project: ProjectDto, now: Date): AgentSettings {
  const { credential } = agent;
  return {
    agent: 'Claude',
    model: agent.model,
    baseUrl: agent.baseUrl ?? '',
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
    pausedKeepMinutes: Math.round(agent.pausedKeepSeconds / 60),
    doneKeepMinutes: Math.round(agent.doneKeepSeconds / 60),
    idleEndMinutes: Math.round(agent.idleEndSeconds / 60),
    maxConcurrent: project.maxConcurrentRuns,
    maxRunsPerTicket: project.maxRunsPerTicket,
    autoResumeMax: agent.autoResumeMax,
  };
}

export interface LimitsRequests {
  project?: Pick<UpdateProjectRequest, 'maxConcurrentRuns' | 'maxRunsPerTicket'>;
  timeoutSeconds?: number;
  pausedKeepSeconds?: number;
  doneKeepSeconds?: number;
  idleEndSeconds?: number;
}

/**
 * What a limits save sends: only the fields changed since `base` (what the form opened with, or last saved), so a
 * limit changed elsewhere meanwhile is not overwritten. Minutes become seconds for the agent.
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
    ...(changed('pausedKeepMinutes') && { pausedKeepSeconds: Math.round(next.pausedKeepMinutes * 60) }),
    ...(changed('doneKeepMinutes') && { doneKeepSeconds: Math.round(next.doneKeepMinutes * 60) }),
    ...(changed('idleEndMinutes') && { idleEndSeconds: Math.round(next.idleEndMinutes * 60) }),
  };
}

/** problem+json pointers of the two limit requests → the screen's limit fields. */
export const LIMIT_POINTERS: Record<string, LimitField> = {
  '/timeoutSeconds': 'timeoutMinutes',
  '/pausedKeepSeconds': 'pausedKeepMinutes',
  '/doneKeepSeconds': 'doneKeepMinutes',
  '/idleEndSeconds': 'idleEndMinutes',
  '/maxConcurrentRuns': 'maxConcurrent',
  '/maxRunsPerTicket': 'maxRunsPerTicket',
};

const LIMIT_FIELDS: ReadonlySet<string> = new Set(Object.values(LIMIT_POINTERS));
const isLimitField = (k: string): k is LimitField => LIMIT_FIELDS.has(k);

/** True when a limits save has something to send. */
export const hasLimitChanges = (req: LimitsRequests): boolean =>
  req.project !== undefined ||
  req.timeoutSeconds !== undefined ||
  req.pausedKeepSeconds !== undefined ||
  req.doneKeepSeconds !== undefined ||
  req.idleEndSeconds !== undefined;

/**
 * Saves the limits: `projects.update` for the run limits and `agents.put` for the timeout and keep times, in parallel. `agents.put`
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
  const saveAgent = async (
    changes: Pick<LimitsRequests, 'timeoutSeconds' | 'pausedKeepSeconds' | 'doneKeepSeconds' | 'idleEndSeconds'>,
  ) => {
    const agent = await qc.fetchQuery({ ...deskQueries.agent(org, projectId), staleTime: 0 });
    // `agents.put` replaces the agent: the run time limit is always sent, the keep times and idle end only when
    // changed (absent keeps the stored value).
    const saved = await api.agents.put({
      params: { projectId },
      body: {
        model: agent.model,
        timeoutSeconds: changes.timeoutSeconds ?? agent.timeoutSeconds,
        ...(agent.maxTurns !== null && { maxTurns: agent.maxTurns }),
        ...(changes.pausedKeepSeconds !== undefined && { pausedKeepSeconds: changes.pausedKeepSeconds }),
        ...(changes.doneKeepSeconds !== undefined && { doneKeepSeconds: changes.doneKeepSeconds }),
        ...(changes.idleEndSeconds !== undefined && { idleEndSeconds: changes.idleEndSeconds }),
      },
    });
    qc.setQueryData(deskQueries.agent(org, projectId).queryKey, saved);
    base.current = {
      ...base.current,
      timeoutMinutes: Math.round(saved.timeoutSeconds / 60),
      pausedKeepMinutes: Math.round(saved.pausedKeepSeconds / 60),
      doneKeepMinutes: Math.round(saved.doneKeepSeconds / 60),
      idleEndMinutes: Math.round(saved.idleEndSeconds / 60),
    };
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
      const { project, ...agentChanges } = requests;
      const agentChanged = hasLimitChanges(agentChanges);
      const results = await Promise.allSettled([
        project && saveProject(project),
        agentChanged && saveAgent(agentChanges),
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
      if (project) void qc.invalidateQueries({ queryKey: projectsListKey(org) });
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

/** Pointer of a refused default model → the model field. */
const MODEL_POINTERS: Record<string, string> = { '/model': 'model' };

/**
 * Saves the default model through `agents.put`. The other fields come from the agent fetched right before the write
 * (staleTime 0), as `useSaveLimits` does; the keep times are not sent, so they keep their stored values (BR-8).
 * Resolves `true` when saved. One save at a time.
 */
export function useSaveAgent(org: string, projectId: string) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const save = async (model: string): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const agent = await qc.fetchQuery({ ...deskQueries.agent(org, projectId), staleTime: 0 });
      const saved = await api.agents.put({
        params: { projectId },
        body: {
          model,
          timeoutSeconds: agent.timeoutSeconds,
          ...(agent.maxTurns !== null && { maxTurns: agent.maxTurns }),
        },
      });
      qc.setQueryData(deskQueries.agent(org, projectId).queryKey, saved);
      return true;
    } catch (e) {
      const problem = fieldErrorsFromProblem(e, MODEL_POINTERS);
      setError(problem.fields.model ?? problem.form);
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return { save, saving, error };
}

/** Shown when the agent could not be refetched after a credential attempt. */
export const REFRESH_ERROR = 'Could not refresh the agent. Reload the page to see its current state.';

/**
 * Refetches the agent and its model list after a credential attempt (shared with the setup wizard). The model list
 * shows its own error state when its refetch fails, so only the agent refetch decides the result: `true` when the
 * agent was refreshed.
 */
export async function refreshAfterCredential(
  qc: QueryClient,
  org: string,
  projectId: string,
  agentId: string,
): Promise<boolean> {
  const [agentRefresh] = await Promise.allSettled([
    qc.invalidateQueries({ queryKey: deskQueries.agent(org, projectId).queryKey }, { throwOnError: true }),
    qc.invalidateQueries({ queryKey: deskQueries.agentModels(org, agentId).queryKey }),
  ]);
  return agentRefresh.status === 'fulfilled';
}

/** Pointers of a refused credential → the token input, or the API address. */
const CREDENTIAL_POINTERS: Record<string, string> = {
  '/value': 'credential',
  '/type': 'credential',
  '/baseUrl': 'address',
};

/**
 * Replaces the agent's credential, with the API address when it changed (`baseUrl` absent keeps it, a string sets it,
 * null clears it). Not a Query mutation on purpose: mutation variables live in the mutation cache, and the token
 * must not be kept anywhere after the request (spec §4.3: write-only, never cached). Resolves `true` when saved.
 * After any attempt, success or failure, the agent and its model list are refetched: a failed write after an
 * address change leaves the new address with no credential (BR-16), and the screen must show that. The model list
 * key is not under the project prefix, so it is invalidated explicitly.
 */
export function useReplaceCredential(org: string, projectId: string, agentId: string) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [addressError, setAddressError] = useState<string>();
  const replace = async (type: CredentialType, value: string, baseUrl?: string | null): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    setAddressError(undefined);
    let saved = false;
    let writeError: string | undefined;
    try {
      await api.agents.putCredential({
        params: { agentId },
        body: { type, value, ...(baseUrl !== undefined && { baseUrl }) },
      });
      saved = true;
    } catch (e) {
      const problem = fieldErrorsFromProblem(e, CREDENTIAL_POINTERS);
      writeError = problem.fields.credential ?? problem.form;
      setAddressError(problem.fields.address);
    }
    // The screen must see the agent refresh, or it would keep the old address and "credential set" (BR-16).
    const refreshed = await refreshAfterCredential(qc, org, projectId, agentId);
    setError([writeError, refreshed ? undefined : REFRESH_ERROR].filter(Boolean).join(' ') || undefined);
    inFlight.current = false;
    setPending(false);
    return saved && refreshed;
  };
  return { replace, pending, error, addressError };
}
