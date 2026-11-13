import type {
  AgentDto,
  CreateProjectRequest,
  CreateRuleRequest,
  CredentialType,
  ProjectDto,
  SetupScriptDto,
  SetupStep,
} from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { projectsQueries } from '../projects/queries';
import { setupQueries as scriptQueries } from '../setup-script/queries';
import { setupQueries } from './queries';
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
  await qc.invalidateQueries({ queryKey: projectsQueries.list(org).queryKey, exact: true });
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
    onSuccess: async (project) => {
      qc.setQueryData(projectsQueries.detail(org, project.id).queryKey, project);
      await qc.invalidateQueries({ queryKey: projectsQueries.list(org).queryKey, exact: true });
    },
  });
}

export interface AgentStepInput {
  model: string;
  maxConcurrentRuns: number;
  credentialType: CredentialType;
  /** The typed secret; empty keeps the credential already set. */
  credential: string;
}

/**
 * Step `agent`: the agent, then the credential, then the project. Not a Query mutation on purpose: mutation
 * variables live in the mutation cache, and the credential must never be kept anywhere after the request.
 */
export function useSaveAgentStep(org: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const save = async (project: ProjectDto, agent: AgentDto, input: AgentStepInput): Promise<ProjectDto> => {
    setPending(true);
    try {
      await api.agents.put({
        params: { projectId: project.id },
        body: {
          model: input.model,
          timeoutSeconds: agent.timeoutSeconds,
          ...(agent.maxTurns !== null && { maxTurns: agent.maxTurns }),
        },
      });
      if (input.credential !== '') {
        await api.agents.putCredential({
          params: { agentId: agent.id },
          body: { type: input.credentialType, value: input.credential },
        });
      }
      await qc.invalidateQueries({ queryKey: setupQueries.agent(org, project.id).queryKey });
      return await finishStep(qc, org, project, 'setup', { maxConcurrentRuns: input.maxConcurrentRuns });
    } finally {
      setPending(false);
    }
  };
  return { save, pending };
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
          qc.invalidateQueries({ queryKey: scriptQueries.versions(org, project.id).queryKey }),
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
        const existing = new Set((await api.skills.list({ params: { projectId: project.id } })).map((s) => s.name));
        for (const t of SKILL_TEMPLATES) {
          if (!names.includes(t.name) || existing.has(t.name)) continue;
          await api.skills.put({ params: { projectId: project.id, name: t.name }, body: { body: t.body, message } });
        }
        await qc.invalidateQueries({ queryKey: setupQueries.skills(org, project.id).queryKey });
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
      const existing = new Set((await api.rules.list({ params: { projectId: project.id } })).map((r) => r.command));
      for (const [index, body] of rules.entries()) {
        if (existing.has(body.command)) continue;
        try {
          await api.rules.create({ params: { projectId: project.id }, body });
        } catch (e) {
          throw new RuleSaveError(index, e);
        }
      }
      await qc.invalidateQueries({ queryKey: setupQueries.rules(org, project.id).queryKey });
      return finishStep(qc, org, project, 'ready');
    },
  });
}

/** Opens the provider's install page (a full-page navigation away from the app). */
export function useInstallConnection() {
  return useMutation({
    mutationFn: (provider: 'github' | 'fake') => api.connections.install({ params: { provider } }),
  });
}
