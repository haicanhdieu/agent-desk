import {
  AGENT_KIND_CAPABILITIES,
  AGENT_TEST_MESSAGES,
  type AgentConnectionDto,
  type AgentDto,
  type AgentKind,
  type AgentTestStatus,
  type ConnectionDto,
  type CreateProjectRequest,
  type CreateRuleRequest,
  type CredentialType,
  type ProjectDto,
  type SetupScriptDto,
  type SetupStep,
} from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { WHOLE_SET } from '@/app/pagination';
import { api } from '../api';
import { authCall, authClient } from '../auth/client';
import { agentsKey, deskQueries, rulesKey, skillsKey } from '../desk/queries';
import { checklistKey } from '../onboarding/checklist';
import { projectsListKey, projectsQueries } from '../projects/queries';
import { setupQueries as scriptQueries, versionsKey } from '../setup-script/queries';
import { setupQueries } from './queries';
import { isProviderReauthRequired } from './reauth';
import { stepIndex } from './steps';
import { SKILL_TEMPLATES } from './templates';

// Step saves (spec §4.5). Each resolves with the project as the server has it after the step, which the route uses
// to move on. The server's `setupStep` only moves forward: saving an earlier step again does not send it back.

export interface StepErrors<F extends string> {
  fields: Partial<Record<F, string>>;
  form?: string;
}

/** Maps problem+json JSON Pointers to step fields (`/value` → `credential`); anything else is a form message. */
export function stepErrors<F extends string>(e: unknown, map: Record<string, F>): StepErrors<F> {
  if (!(e instanceof ApiError)) return { fields: {}, form: 'Something went wrong. Try again.' };
  const fields: Partial<Record<F, string>> = {};
  const unmapped: string[] = [];
  for (const err of e.errors ?? []) {
    const field = map[err.pointer];
    if (field && fields[field] === undefined) fields[field] = err.detail;
    else if (!field) unmapped.push(err.detail);
  }
  const hasFields = Object.keys(fields).length > 0;
  if (hasFields && unmapped.length === 0) return { fields };
  return { fields, form: [e.detail ?? e.title, ...unmapped].join(' ') };
}

/** `to` when it is past the project's step, else nothing (no step goes backwards). */
export function advance(current: SetupStep, to: SetupStep): SetupStep | undefined {
  return stepIndex(to) > stepIndex(current) ? to : undefined;
}

async function finishStep(
  qc: QueryClient,
  org: string,
  project: ProjectDto,
  to: SetupStep,
  extra: { maxConcurrentRuns?: number } = {},
): Promise<ProjectDto> {
  const setupStep = advance(project.setupStep, to);
  const body = { ...extra, ...(setupStep && { setupStep }) };
  const next =
    Object.keys(body).length > 0 ? await api.projects.update({ params: { projectId: project.id }, body }) : project;
  qc.setQueryData(projectsQueries.detail(org, project.id).queryKey, next);
  await qc.invalidateQueries({ queryKey: projectsListKey(org) });
  return next;
}

export type RepoStepInput =
  | { kind: 'create'; body: CreateProjectRequest }
  | {
      kind: 'update';
      project: ProjectDto;
      body: Pick<CreateProjectRequest, 'name' | 'triggerMode' | 'pollIntervalSeconds'>;
    };

/** Step `repo`: creates the project (connection, repository, trigger mode), or updates it when revisited. */
export function useSaveRepoStep(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RepoStepInput) =>
      input.kind === 'create'
        ? api.projects.create({ body: input.body })
        : api.projects.update({ params: { projectId: input.project.id }, body: input.body }),
    onSuccess: async (project, input) => {
      qc.setQueryData(projectsQueries.detail(org, project.id).queryKey, project);
      // A created project completes the checklist's "Create a project" step; an update keeps it.
      await Promise.all([
        qc.invalidateQueries({ queryKey: projectsListKey(org) }),
        ...(input.kind === 'create' ? [qc.invalidateQueries({ queryKey: checklistKey(org) })] : []),
      ]);
    },
  });
}

export interface AgentStepInput {
  /** The picked agent kind. */
  kind: AgentKind;
  /** The default model; '' only for a kind whose model is optional. */
  model: string;
  maxConcurrentRuns: number;
  /** null = the kind needs no choice (nothing typed for a kind whose credential is optional). */
  credentialType: CredentialType | null;
  /** The typed secret; empty writes no credential. */
  credential: string;
  /** The typed API address, '' = the kind's default. Sent only for a kind that has one, and only when it changed. */
  baseUrl: string;
}

/** The connection test refused the credential or could not reach the address: the step stays (Continue anyway). */
export interface AgentTestFailure {
  status: AgentTestStatus;
  message: string;
}

/**
 * The credential write failed or the agent could not be refetched after it. `writeError` is the refused write (if
 * any), so its field errors still show; the route adds that the agent could not be refreshed.
 */
export class CredentialRefreshError extends Error {
  readonly writeError: unknown;
  constructor(writeError: unknown) {
    super('The agent could not be refreshed after the credential save');
    this.name = 'CredentialRefreshError';
    this.writeError = writeError;
  }
}

const STEP_AGENT = stepIndex('agent');
/** The name project creation gives the credential-less Claude it seeds (apps/api projects.service). */
const PLACEHOLDER_NAME = 'Claude';

/**
 * Step `agent` (spec multi-agent configs, BR-53, BR-63 to BR-65): the agent of the picked kind, its credential, its
 * connection test, then the project. A kind the project already has is reused (the placeholder for Claude Code, or the
 * agent an earlier attempt created); otherwise one is created, made the default, and the credential-less placeholder
 * it replaces is deleted (best effort). The project keeps at least one agent and exactly one default after every call.
 * Not a Query mutation on purpose: mutation variables live in the mutation cache, and the credential must never be
 * kept anywhere after the request.
 */
export function useSaveAgentStep(org: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<string>();
  const running = useRef(false);

  const save = async (
    project: ProjectDto,
    input: AgentStepInput,
  ): Promise<{ project: ProjectDto } | { testFailed: AgentTestFailure } | undefined> => {
    // A second Continue while one is running does nothing: it must not create a second agent.
    if (running.current) return undefined;
    running.current = true;
    setPending(true);
    try {
      const target = await prepareAgent(project, input, setProgress);
      let tested: AgentConnectionDto['status'] | undefined;
      if (input.credential !== '') {
        setProgress('Saving credential...');
        await replaceCredential(qc, org, project.id, target, input);
        setProgress('Testing connection...');
        const answer = await api.agents.test({ params: { agentId: target.id } });
        tested = answer.status;
      }
      await refreshAgents(qc, org, project.id);
      if (tested === 'rejected' || tested === 'unreachable') {
        return { testFailed: { status: tested, message: AGENT_TEST_MESSAGES[tested] } };
      }
      return { project: await finishStep(qc, org, project, 'setup', { maxConcurrentRuns: input.maxConcurrentRuns }) };
    } finally {
      running.current = false;
      setPending(false);
      setProgress(undefined);
    }
  };

  /** "Continue anyway" after a failed test: the agent and credential are saved, so only the project moves on. */
  const continueAnyway = async (project: ProjectDto, maxConcurrentRuns: number): Promise<ProjectDto> => {
    setPending(true);
    try {
      return await finishStep(qc, org, project, 'setup', { maxConcurrentRuns });
    } finally {
      setPending(false);
    }
  };
  return { save, continueAnyway, pending, progress };
}

/** Resolves the agent the step configures: the project's agent of that kind, or a new default one. */
async function prepareAgent(
  project: ProjectDto,
  input: AgentStepInput,
  setProgress: (text: string) => void,
): Promise<AgentDto> {
  const cap = AGENT_KIND_CAPABILITIES[input.kind];
  setProgress('Saving agent...');
  const { items } = await api.agents.list({ params: { projectId: project.id }, query: WHOLE_SET });
  const ofKind =
    items.find((a) => a.provider === input.kind && a.isDefault) ?? items.find((a) => a.provider === input.kind);
  let agent: AgentDto;
  if (ofKind) {
    // An empty model is valid only for a kind whose model is optional (OpenCode); for the others the model stays.
    const unchanged = ofKind.model === input.model || (input.model === '' && !cap.modelOptional);
    agent = unchanged
      ? ofKind
      : await api.agents.update({ params: { agentId: ofKind.id }, body: { model: input.model } });
  } else {
    agent = await api.agents.create({
      params: { projectId: project.id },
      body: { provider: input.kind, name: cap.label, ...(input.model !== '' && { model: input.model }) },
    });
  }
  if (!agent.isDefault) agent = await api.agents.setDefault({ params: { agentId: agent.id } });
  // On every Continue, a retry too: the delete of an earlier attempt may have failed, or the credential write after it.
  // Only once the agent is the default (the line above succeeded), and never with a credential, a rule on it, or past
  // this step.
  const placeholder = replacedPlaceholder(items, agent);
  if (placeholder && stepIndex(project.setupStep) <= STEP_AGENT) {
    try {
      await api.agents.remove({ params: { agentId: placeholder.id } });
    } catch {
      // Best effort: the row stays, not the default, and shows "Needs credential" in the Agents tab.
    }
  }
  return agent;
}

/**
 * The credential-less Claude that project creation made, once another agent is the default: the default the step
 * replaced, or on a retry the leftover non-default one. Not one with a credential or a rule on it.
 */
function replacedPlaceholder(items: AgentDto[], agent: AgentDto): AgentDto | undefined {
  if (!agent.isDefault) return undefined;
  const previousDefault = items.find((a) => a.isDefault && a.id !== agent.id);
  const candidate =
    previousDefault ??
    items.find((a) => a.id !== agent.id && !a.isDefault && a.provider === 'claude' && a.name === PLACEHOLDER_NAME);
  return candidate && !candidate.credential.set && candidate.usage.rules === 0 ? candidate : undefined;
}

/** The setup reads of the agent, the Desk's agent reads and the checklist, after the agents changed. */
async function refreshAgents(qc: QueryClient, org: string, projectId: string): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: agentsKey(org, projectId) }),
    qc.invalidateQueries({ queryKey: deskQueries.agent(org, projectId).queryKey }),
    qc.invalidateQueries({ queryKey: checklistKey(org) }),
  ]);
}

/**
 * Writes the credential (with the address when it changed and the kind has one). After a failed attempt the agent and
 * its model list are refetched: a failed write after an address change leaves the new address with no credential
 * (BR-16), and the step must show that. The model list key is not under the project prefix, so it is invalidated
 * explicitly.
 */
async function replaceCredential(
  qc: QueryClient,
  org: string,
  projectId: string,
  agent: AgentDto,
  input: AgentStepInput,
): Promise<void> {
  const cap = AGENT_KIND_CAPABILITIES[input.kind];
  const type = input.credentialType ?? cap.credentialTypes[0]?.type;
  if (!type) return;
  const addressChanged = cap.baseUrl !== null && input.baseUrl !== (agent.baseUrl ?? '');
  let writeError: unknown;
  let failed = false;
  try {
    await api.agents.putCredential({
      params: { agentId: agent.id },
      body: {
        type,
        value: input.credential,
        ...(addressChanged && { baseUrl: input.baseUrl === '' ? null : input.baseUrl }),
      },
    });
  } catch (e) {
    failed = true;
    writeError = e;
  }
  const [agentRefresh] = await Promise.allSettled([
    qc.invalidateQueries({ queryKey: agentsKey(org, projectId) }, { throwOnError: true }),
    qc.invalidateQueries({ queryKey: deskQueries.agentModels(org, agent.id).queryKey }),
  ]);
  if (agentRefresh.status === 'rejected') throw new CredentialRefreshError(failed ? writeError : undefined);
  if (failed) throw writeError;
}

export interface WorkspaceStepInput {
  project: ProjectDto;
  /** The script saved so far (null when none); the base of the save. */
  saved: SetupScriptDto | null;
  /** The editor's text to save as the next version, or null to skip the step without saving anything. */
  body: string | null;
}

/**
 * Step `setup` ("Prepare workspace", optional): saves the editor's text as a new script version unless it is the one
 * already saved, then marks the step done. Skip (`body: null`) only marks it done: no script is stored.
 */
export function useSaveWorkspaceStep(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ project, saved, body }: WorkspaceStepInput) => {
      if (body !== null && body !== saved?.body) {
        const next = await api.setupScript.put({
          params: { projectId: project.id },
          body: { body, baseVersion: saved?.version ?? null },
        });
        qc.setQueryData(scriptQueries.script(org, project.id).queryKey, next);
        await Promise.all([
          qc.invalidateQueries({ queryKey: versionsKey(org, project.id) }),
          qc.invalidateQueries({ queryKey: scriptQueries.latest(org, project.id).queryKey }),
        ]);
      }
      return finishStep(qc, org, project, 'skills');
    },
  });
}

/** Step `skills`: one commit per picked template not in the repo yet (a retry skips the ones already there). */
export function useSaveSkillsStep(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ project, names, message }: { project: ProjectDto; names: string[]; message: string }) => {
      if (names.length > 0) {
        const existing = new Set(
          (await api.skills.list({ params: { projectId: project.id }, query: WHOLE_SET })).items.map((s) => s.name),
        );
        for (const t of SKILL_TEMPLATES) {
          if (!names.includes(t.name) || existing.has(t.name)) continue;
          await api.skills.put({ params: { projectId: project.id, name: t.name }, body: { body: t.body, message } });
        }
        await qc.invalidateQueries({ queryKey: skillsKey(org, project.id) });
      }
      return finishStep(qc, org, project, 'rules');
    },
  });
}

/** A rule of the step failed to save; `index` says which, so its field errors land on the right form. */
export class RuleSaveError extends Error {
  readonly index: number;
  override readonly cause: unknown;
  constructor(index: number, cause: unknown) {
    super(`Rule ${index + 1} was not saved`);
    this.name = 'RuleSaveError';
    this.index = index;
    this.cause = cause;
  }
}

/** Step `rules`: creates each rule whose command the project does not have yet, then marks setup ready. */
export function useSaveRulesStep(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ project, rules }: { project: ProjectDto; rules: CreateRuleRequest[] }) => {
      // Skip (no rules) needs only the project update: it creates nothing, so it does not read the rules.
      if (rules.length === 0) return finishStep(qc, org, project, 'ready');
      const existing = new Set(
        (await api.rules.list({ params: { projectId: project.id }, query: WHOLE_SET })).items.map((r) => r.command),
      );
      for (const [index, body] of rules.entries()) {
        if (existing.has(body.command)) continue;
        try {
          await api.rules.create({ params: { projectId: project.id }, body });
        } catch (e) {
          throw new RuleSaveError(index, e);
        }
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: rulesKey(org, project.id) }),
        qc.invalidateQueries({ queryKey: checklistKey(org) }),
      ]);
      return finishStep(qc, org, project, 'ready');
    },
  });
}

export type ConnectOutcome = { kind: 'linked'; connection: ConnectionDto } | { kind: 'install'; url: string };

/**
 * Refresh repositories: links the installations the user's GitHub account can reach into this org, then reads the
 * org's connections and the repository list of every active one again. Any failing step rejects, so an error is
 * never shown as an empty list.
 */
export function useRefreshRepositories(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await api.connections.sync({ params: { provider: 'github' } });
      const connections = await qc.fetchQuery({ ...setupQueries.connections(org), staleTime: 0 });
      const usable = connections.filter((c) => c.status === 'active' && c.capabilities.code);
      await Promise.all(usable.map((c) => qc.fetchQuery({ ...setupQueries.repos(org, c.id), staleTime: 0 })));
      await qc.invalidateQueries({ queryKey: checklistKey(org) });
    },
  });
}

/**
 * Connects a provider. An app already installed there never redirects back, so first link what the user's own
 * account can see; only when that adds no new connection (or the lookup fails), ask for the install page (a
 * full-page navigation away). A connection the org could already use does not count: the user may be asking to
 * change which repositories the app can access. A GitHub account that must be connected again is not a failed shortcut:
 * the install page cannot fix it, so that error is passed on.
 */
export function useInstallConnection(org: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (provider: 'github' | 'fake'): Promise<ConnectOutcome> => {
      const usable = (c: ConnectionDto) => c.provider === provider && c.status === 'active' && c.capabilities.code;
      let linked: ConnectionDto | undefined;
      try {
        const known = new Set((await api.connections.list()).filter(usable).map((c) => c.id));
        linked = (await api.connections.sync({ params: { provider } })).find((c) => usable(c) && !known.has(c.id));
      } catch (e) {
        if (isProviderReauthRequired(e)) throw e;
        // The lookup is a shortcut; when it fails the install page is still the way to connect.
      }
      if (linked) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: setupQueries.connections(org).queryKey }),
          qc.invalidateQueries({ queryKey: checklistKey(org) }),
        ]);
        return { kind: 'linked', connection: linked };
      }
      const { url } = await api.connections.install({ params: { provider } });
      return { kind: 'install', url };
    },
  });
}

/**
 * Signs in with GitHub again, which stores a fresh GitHub token for the account, and comes back to `returnTo` (a
 * relative path). The browser leaves the page on success, so the mutation only ever settles on a failure.
 */
export function useReconnectGithub() {
  return useMutation({
    mutationFn: (returnTo: string) =>
      authCall(() =>
        authClient.signIn.social({ provider: 'github', callbackURL: returnTo, errorCallbackURL: returnTo }),
      ),
  });
}
