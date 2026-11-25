import type { AgentDto, CredentialType, ProjectDto, UpdateProjectRequest } from '@agentdesk/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { AgentSettings } from '@/mocks/types';
import type { AgentLimits, LimitField } from '@/screens';
import { api } from '../api';
import { checklistKey } from '../onboarding/checklist';
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
    ...limitsOf(project),
  };
}

export function limitsOf(project: ProjectDto): AgentLimits {
  return {
    timeoutMinutes: Math.round(project.timeoutSeconds / 60),
    pausedKeepMinutes: Math.round(project.pausedKeepSeconds / 60),
    doneKeepMinutes: Math.round(project.doneKeepSeconds / 60),
    idleEndMinutes: Math.round(project.idleEndSeconds / 60),
    maxConcurrent: project.maxConcurrentRuns,
    maxRunsPerTicket: project.maxRunsPerTicket,
    autoResumeMax: project.autoResumeMax,
  };
}

/** The limit fields of `UpdateProjectRequest`: every limit is project-wide and one request writes them. */
export type LimitsRequests = Pick<
  UpdateProjectRequest,
  | 'maxConcurrentRuns'
  | 'maxRunsPerTicket'
  | 'timeoutSeconds'
  | 'pausedKeepSeconds'
  | 'doneKeepSeconds'
  | 'idleEndSeconds'
  | 'autoResumeMax'
>;

/**
 * What a limits save sends: only the fields changed since `base` (what the form opened with, or last saved), so a
 * limit changed elsewhere meanwhile is not overwritten. Minutes become seconds.
 */
export function limitsRequests(base: AgentLimits, next: AgentLimits): LimitsRequests {
  const changed = (k: LimitField) => !Object.is(base[k], next[k]);
  return {
    ...(changed('maxConcurrent') && { maxConcurrentRuns: next.maxConcurrent }),
    ...(changed('maxRunsPerTicket') && { maxRunsPerTicket: next.maxRunsPerTicket }),
    ...(changed('timeoutMinutes') && { timeoutSeconds: Math.round(next.timeoutMinutes * 60) }),
    ...(changed('pausedKeepMinutes') && { pausedKeepSeconds: Math.round(next.pausedKeepMinutes * 60) }),
    ...(changed('doneKeepMinutes') && { doneKeepSeconds: Math.round(next.doneKeepMinutes * 60) }),
    ...(changed('idleEndMinutes') && { idleEndSeconds: Math.round(next.idleEndMinutes * 60) }),
    ...(changed('autoResumeMax') && { autoResumeMax: next.autoResumeMax }),
  };
}

/** problem+json pointers of the limits request → the screen's limit fields. */
export const LIMIT_POINTERS: Record<string, LimitField> = {
  '/timeoutSeconds': 'timeoutMinutes',
  '/pausedKeepSeconds': 'pausedKeepMinutes',
  '/doneKeepSeconds': 'doneKeepMinutes',
  '/idleEndSeconds': 'idleEndMinutes',
  '/maxConcurrentRuns': 'maxConcurrent',
  '/maxRunsPerTicket': 'maxRunsPerTicket',
  '/autoResumeMax': 'autoResumeMax',
};

const LIMIT_FIELDS: ReadonlySet<string> = new Set(Object.values(LIMIT_POINTERS));
const isLimitField = (k: string): k is LimitField => LIMIT_FIELDS.has(k);

/** True when a limits save has something to send. */
export const hasLimitChanges = (req: LimitsRequests): boolean => Object.keys(req).length > 0;

/**
 * Saves the project-wide limits with one `projects.update` (they apply to every agent). Field messages come from the
 * problem pointers; one save at a time.
 */
export function useSaveLimits(org: string, projectId: string, initial: AgentLimits, { onSaved }: { onSaved(): void }) {
  const qc = useQueryClient();
  const base = useRef(initial);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<LimitField, string>>>({});
  const [formError, setFormError] = useState<string>();

  const save = async (next: AgentLimits) => {
    if (inFlight.current) return;
    const body = limitsRequests(base.current, next);
    // Nothing changed since the last save: nothing to send and nothing to confirm.
    if (!hasLimitChanges(body)) return;
    inFlight.current = true;
    setSaving(true);
    setErrors({});
    setFormError(undefined);
    try {
      const saved = await api.projects.update({ params: { projectId }, body });
      qc.setQueryData(projectsQueries.detail(org, projectId).queryKey, saved);
      base.current = limitsOf(saved);
      void qc.invalidateQueries({ queryKey: projectsListKey(org) });
      onSaved();
    } catch (e) {
      const problem = fieldErrorsFromProblem(e, LIMIT_POINTERS);
      // The problem's fields are keyed by the map's values, i.e. limit fields.
      const fields: Partial<Record<LimitField, string>> = {};
      for (const [k, v] of Object.entries(problem.fields)) if (isLimitField(k)) fields[k] = v;
      setErrors(fields);
      setFormError(problem.form);
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
    // A saved credential completes the checklist's "Add an agent" step.
    if (saved) await qc.invalidateQueries({ queryKey: checklistKey(org) });
    setError([writeError, refreshed ? undefined : REFRESH_ERROR].filter(Boolean).join(' ') || undefined);
    inFlight.current = false;
    setPending(false);
    return saved && refreshed;
  };
  return { replace, pending, error, addressError };
}
