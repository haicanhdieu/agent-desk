import {
  AGENT_NAME_MAX,
  CreateAgentRequest,
  UpdateAgentRequest,
  type AgentDto,
  type CredentialType,
  type ProjectDto,
  type UpdateProjectRequest,
} from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import type { AgentPaneField, AgentPaneValues } from '@/components';
import type { AgentPaneAgent, AgentSettings } from '@/mocks/types';
import type { AgentLimits, LimitField } from '@/screens';
import { api } from '../api';
import { checklistKey } from '../onboarding/checklist';
import { projectsListKey, projectsQueries } from '../projects/queries';
import { relativeTime } from '../relativeTime';
import { fieldErrorsFromProblem, GENERIC_FORM_ERROR } from './problem';
import { agentsKey, deskQueries, rulesKey } from './queries';

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

/** problem+json pointers of the create and update requests → the pane's fields. */
const AGENT_POINTERS: Record<string, AgentPaneField> = {
  '/provider': 'provider',
  '/name': 'name',
  '/accountLabel': 'accountLabel',
  '/model': 'model',
  '/maxTurns': 'maxTurns',
};

const isPaneField = (k: string): k is AgentPaneField =>
  Object.values(AGENT_POINTERS).some((f) => f === k) || k === 'baseUrl' || k === 'value';

export type SaveFieldErrors = Partial<Record<AgentPaneField, string>>;

/** What each add step did: `skipped` = nothing to do, `failed` = tried and refused. */
export type StepState = 'skipped' | 'done' | 'failed';

export interface AddResult {
  /** The agent exists and its credential (when one was typed) is saved. A failed test or default does not undo it. */
  ok: boolean;
  /** Set as soon as create worked, so a retry never creates twice. */
  agentId?: string;
  steps: Record<'create' | 'credential' | 'test' | 'setDefault', StepState>;
  /** A refusal that belongs to no field. */
  error?: string;
  /** The agent was saved but could not be made the default. */
  defaultError?: string;
}

export interface EditResult {
  ok: boolean;
  /** The default moved to this agent in this save. */
  defaultChanged: boolean;
  error?: string;
}

/** The agent was created but its credential was not saved: the pane resumes on it as "Edit agent". */
export interface PartialAdd {
  agentId: string;
  reason: string;
  requestId?: string;
  /** What was typed apart from the secret, to seed the Edit pane. */
  draft: { makeDefault: boolean; authType: CredentialType | null; address: string };
}

const TOO_LONG = `Use ${AGENT_NAME_MAX} characters or fewer.`;

/** Zod issues of a request → the pane's field messages (the first issue of a field wins). */
function fieldErrorsFromIssues(error: z.ZodError): SaveFieldErrors {
  const out: SaveFieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    if (!isPaneField(key) || out[key] !== undefined) continue;
    if (key === 'name') out.name = issue.code === 'too_big' ? TOO_LONG : 'Enter a name.';
    else if (key === 'accountLabel')
      out.accountLabel = issue.code === 'too_big' ? TOO_LONG : 'Enter a label or clear it.';
    else out[key] = issue.message;
  }
  return out;
}

function fieldsOf(e: unknown): { fields: SaveFieldErrors; form?: string } {
  const problem = fieldErrorsFromProblem(e, AGENT_POINTERS);
  const fields: SaveFieldErrors = {};
  for (const [k, v] of Object.entries(problem.fields)) if (isPaneField(k)) fields[k] = v;
  return { fields, ...(problem.form !== undefined && { form: problem.form }) };
}

/** Refreshes what an agent write can change: both agent reads, the rules lists, the checklist and the model list. */
async function refreshAgentData(qc: QueryClient, org: string, projectId: string, agentId?: string) {
  await Promise.all([
    qc.invalidateQueries({ queryKey: agentsKey(org, projectId) }),
    qc.invalidateQueries({ queryKey: rulesKey(org, projectId) }),
    qc.invalidateQueries({ queryKey: deskQueries.agent(org, projectId).queryKey }),
    qc.invalidateQueries({ queryKey: checklistKey(org) }),
    agentId === undefined
      ? undefined
      : qc.invalidateQueries({ queryKey: deskQueries.agentModels(org, agentId).queryKey }),
  ]);
}

const noSteps = (): AddResult['steps'] => ({
  create: 'skipped',
  credential: 'skipped',
  test: 'skipped',
  setDefault: 'skipped',
});

/**
 * Saves the add and edit panes. `add` is one orchestrated function: create (with the chosen model, if any), the
 * credential (only if one was typed), the connection test, then set-default (only if ticked); it returns what each
 * step did so the pane can resume. `edit` sends one PATCH of the changed fields, then set-default if ticked.
 * Not optimistic: nothing shows as saved before the API says so. Not a Query mutation on purpose: the typed secret is
 * only an argument of the credential request and is kept nowhere (mutation variables live in the mutation cache).
 */
export function useSaveAgent(org: string, projectId: string) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<SaveFieldErrors>({});
  const [partial, setPartial] = useState<PartialAdd>();

  const begin = (): boolean => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setFieldErrors({});
    return true;
  };
  const end = () => {
    inFlight.current = false;
    setSaving(false);
    setProgress(undefined);
  };

  const add = async (values: AgentPaneValues): Promise<AddResult> => {
    const steps = noSteps();
    if (!begin()) return { ok: false, steps };
    try {
      setPartial(undefined);
      const parsed = CreateAgentRequest.safeParse({
        provider: values.provider,
        name: values.name,
        ...(values.accountLabel !== '' && { accountLabel: values.accountLabel }),
        ...(values.model !== '' && { model: values.model }),
      });
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromIssues(parsed.error));
        steps.create = 'failed';
        return { ok: false, steps };
      }
      setProgress('Saving agent…');
      let agentId: string;
      try {
        agentId = (await api.agents.create({ params: { projectId }, body: parsed.data })).id;
      } catch (e) {
        const problem = fieldsOf(e);
        setFieldErrors(problem.fields);
        steps.create = 'failed';
        return { ok: false, steps, ...(problem.form !== undefined && { error: problem.form }) };
      }
      steps.create = 'done';
      const result: AddResult = { ok: true, agentId, steps };
      if (values.credential) {
        setProgress('Saving credential…');
        const { type, value, baseUrl } = values.credential;
        try {
          await api.agents.putCredential({
            params: { agentId },
            // A credentials file takes no address.
            body: { type, value, ...(baseUrl !== undefined && type !== 'auth_json' && { baseUrl }) },
          });
          steps.credential = 'done';
        } catch (e) {
          const problem = fieldErrorsFromProblem(e, CREDENTIAL_POINTERS);
          const reason = problem.fields.credential ?? problem.fields.address ?? problem.form ?? GENERIC_FORM_ERROR;
          steps.credential = 'failed';
          setPartial({
            agentId,
            reason,
            draft: { makeDefault: values.makeDefault, authType: type, address: baseUrl ?? '' },
            ...(e instanceof ApiError && e.requestId !== undefined && { requestId: e.requestId }),
          });
          await refreshAgentData(qc, org, projectId, agentId);
          return { ok: false, agentId, steps, error: reason };
        }
        setProgress('Testing connection…');
        try {
          await api.agents.test({ params: { agentId } });
          steps.test = 'done';
        } catch {
          // A test that cannot run is not a save failure: the row shows "Not tested".
          steps.test = 'failed';
        }
      }
      if (values.makeDefault) {
        try {
          await api.agents.setDefault({ params: { agentId } });
          steps.setDefault = 'done';
        } catch (e) {
          steps.setDefault = 'failed';
          result.defaultError = e instanceof ApiError ? e.title : GENERIC_FORM_ERROR;
        }
      }
      await refreshAgentData(qc, org, projectId, agentId);
      return result;
    } finally {
      end();
    }
  };

  const edit = async (agent: AgentPaneAgent, values: AgentPaneValues): Promise<EditResult> => {
    if (!begin()) return { ok: false, defaultChanged: false };
    try {
      const body = {
        ...(values.name !== agent.name && { name: values.name }),
        ...(values.accountLabel !== agent.accountLabel && {
          accountLabel: values.accountLabel === '' ? null : values.accountLabel,
        }),
        ...(values.model !== agent.model && { model: values.model }),
        ...(values.maxTurns !== agent.maxTurns && { maxTurns: values.maxTurns }),
      };
      const parsed = UpdateAgentRequest.safeParse(body);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromIssues(parsed.error));
        return { ok: false, defaultChanged: false };
      }
      setProgress('Saving agent…');
      try {
        if (Object.keys(parsed.data).length > 0) {
          await api.agents.update({ params: { agentId: agent.id }, body: parsed.data });
        }
      } catch (e) {
        const problem = fieldsOf(e);
        setFieldErrors(problem.fields);
        return { ok: false, defaultChanged: false, ...(problem.form !== undefined && { error: problem.form }) };
      }
      let defaultChanged = false;
      let error: string | undefined;
      if (values.makeDefault && !agent.isDefault) {
        try {
          await api.agents.setDefault({ params: { agentId: agent.id } });
          defaultChanged = true;
        } catch (e) {
          error = e instanceof ApiError ? e.title : GENERIC_FORM_ERROR;
        }
      }
      await refreshAgentData(qc, org, projectId, agent.id);
      return { ok: error === undefined, defaultChanged, ...(error !== undefined && { error }) };
    } finally {
      end();
    }
  };

  return {
    add,
    edit,
    saving,
    progress,
    fieldErrors,
    partial,
    /** Drops the field messages and the partial-add banner (the pane closed or changed). */
    reset: () => {
      setFieldErrors({});
      setPartial(undefined);
    },
    clearPartial: () => setPartial(undefined),
  };
}

/** Deletes an agent. A 409 (a rule or an open run uses it) rejects with the ApiError: the dialog shows the reason. */
export function useDeleteAgent(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.agents.remove({ params: { agentId } }),
    onSuccess: async (_, agentId) => {
      qc.removeQueries({ queryKey: deskQueries.agentModels(org, agentId).queryKey });
      await refreshAgentData(qc, org, projectId);
    },
  });
}

/** Moves the project default to this agent. Not optimistic: the chip moves when the lists refetch. */
export function useSetDefaultAgent(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.agents.setDefault({ params: { agentId } }),
    onSuccess: () => refreshAgentData(qc, org, projectId),
  });
}

/** Checks the saved credential. The answer carries a fixed message per status, never provider text. */
export function useTestAgent(org: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.agents.test({ params: { agentId } }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: agentsKey(org, projectId) }),
        qc.invalidateQueries({ queryKey: deskQueries.agent(org, projectId).queryKey }),
      ]),
  });
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
export function useReplaceCredential(org: string, projectId: string, agentId: string | undefined) {
  const qc = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [addressError, setAddressError] = useState<string>();
  const replace = async (type: CredentialType, value: string, baseUrl?: string | null): Promise<boolean> => {
    // No agent yet (the Add pane): nothing to replace.
    if (inFlight.current || agentId === undefined) return false;
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
  /** Drops the last attempt's messages (the pane closed or changed). */
  const reset = () => {
    setError(undefined);
    setAddressError(undefined);
  };
  return { replace, reset, pending, error, addressError };
}
