import type { ConnectionDto, ProjectDto } from '@agentdesk/contracts';
import { useQuery, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import type { RuleDraft } from '@/components';
import { CommandChip, useToast } from '@/ds';
import { sessionQuery } from '@/features/auth/session';
import { pollIntervalLabel } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { browserLocation } from '@/features/setup/location';
import {
  agentSummary,
  credentialDetail,
  lastEvent,
  pollSeconds,
  repoMeta,
  repoName,
  ruleWhere,
  triggerProgress,
} from '@/features/setup/map';
import {
  RuleSaveError,
  stepErrors,
  useInstallConnection,
  useSaveAgentStep,
  useSaveRepoStep,
  useSaveRulesStep,
  useSaveSkillsStep,
  type StepErrors,
} from '@/features/setup/mutations';
import { setupQueries } from '@/features/setup/queries';
import { resolveStep } from '@/features/setup/resume';
import { SetupSearch, SetupStepParam } from '@/features/setup/steps';
import { SKILL_TEMPLATES } from '@/features/setup/templates';
import { connectionCopy } from '@/mocks/connection';
import type { Actor } from '@/mocks/types';
import { Setup1, Setup2, Setup3, Setup4, SetupReady, type Setup1Draft, type Setup2Draft } from '@/screens';

// Setup (spec §4.5): one route per step, each saving on Continue. Which step shows comes only from the server's
// `project.setupStep` (via `?project=`): asking for a later step than the project has reached redirects there.

export const Route = createFileRoute('/o/$org/projects/new/$step')({
  validateSearch: (search) => SetupSearch.parse(search),
  beforeLoad: async ({ context: { queryClient }, params, search }) => {
    const requested = SetupStepParam.safeParse(params.step);
    if (!requested.success) throw notFound();
    const project = search.project
      ? await queryClient.ensureQueryData(projectsQueries.detail(params.org, search.project))
      : null;
    const step = resolveStep(requested.data, project);
    if (step !== requested.data) {
      throw redirect({
        to: '/o/$org/projects/new/$step',
        params: { org: params.org, step },
        search: project ? { project: project.id } : {},
        replace: true,
      });
    }
    return { step };
  },
  loaderDeps: ({ search }) => ({ project: search.project, connection: search.connection }),
  loader: async ({ context: { queryClient, step }, params: { org }, deps }) => {
    const projectId = deps.project;
    const ensure = queryClient.ensureQueryData.bind(queryClient);
    if (step === 'repo') {
      const connections = await ensure(setupQueries.connections(org));
      await Promise.all([
        ...usableConnections(connections, deps.connection).map((c) => ensure(setupQueries.repos(org, c.id))),
        ...(projectId ? [ensure(projectsQueries.connection(org, projectId))] : []),
      ]);
      return;
    }
    if (!projectId) return;
    await Promise.all([
      ensure(setupQueries.agent(org, projectId)),
      ...(step === 'rules' || step === 'ready' ? [ensure(setupQueries.skills(org, projectId))] : []),
      ...(step === 'ready'
        ? [ensure(setupQueries.rules(org, projectId)), ensure(projectsQueries.connection(org, projectId))]
        : []),
    ]);
  },
  component: SetupPage,
});

/** Connections that can host a project's code, or only the one named in the URL (after an install). */
function usableConnections(connections: ConnectionDto[], only: string | undefined): ConnectionDto[] {
  return connections.filter(
    (c) => c.status === 'active' && c.capabilities.code && (only === undefined || c.id === only),
  );
}

function useActor(): Actor {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const handle = session?.user.handle ?? '';
  return { login: handle, initials: handle.slice(0, 2).toUpperCase() };
}

function SetupPage() {
  const { step } = Route.useRouteContext();
  const { org } = Route.useParams();
  const { project: projectId, connection } = Route.useSearch();
  if (step === 'repo') return <RepoStep org={org} projectId={projectId} connectionId={connection} />;
  // beforeLoad sends every later step without a project to `repo`.
  if (!projectId) throw notFound();
  switch (step) {
    case 'agent':
      return <AgentStep org={org} projectId={projectId} />;
    case 'skills':
      return <SkillsStep org={org} projectId={projectId} />;
    case 'rules':
      return <RulesStep org={org} projectId={projectId} />;
    case 'ready':
      return <ReadyStep org={org} projectId={projectId} />;
  }
}

type LaterStep = 'agent' | 'skills' | 'rules' | 'ready';

/** Moves to `step` of the same project. */
function useGoToStep(org: string) {
  const navigate = useNavigate();
  return (step: LaterStep, project: ProjectDto) =>
    navigate({ to: '/o/$org/projects/new/$step', params: { org, step }, search: { project: project.id } });
}

const stepHref = (org: string, step: SetupStepParam, projectId: string) =>
  `/o/${encodeURIComponent(org)}/projects/new/${step}?project=${encodeURIComponent(projectId)}`;

const noErrors = { fields: {} };

const REPO_POINTERS = {
  '/name': 'name',
  '/repoPath': 'repo',
  '/connectionId': 'repo',
  '/triggerMode': 'mode',
  '/pollIntervalSeconds': 'mode',
} as const;

function RepoStep({ org, projectId, connectionId }: { org: string; projectId?: string; connectionId?: string }) {
  const user = useActor();
  const now = useNow();
  const toast = useToast();
  const goTo = useGoToStep(org);
  const { data: project } = useQuery({ ...projectsQueries.detail(org, projectId ?? ''), enabled: !!projectId });
  const { data: progress, refetch: refetchProgress } = useQuery({
    ...projectsQueries.connection(org, projectId ?? ''),
    enabled: !!projectId,
  });
  const { data: connections } = useSuspenseQuery(setupQueries.connections(org));
  const usable = usableConnections(connections, connectionId);
  const repoLists = useSuspenseQueries({ queries: usable.map((c) => setupQueries.repos(org, c.id)) });
  const save = useSaveRepoStep(org);
  const install = useInstallConnection();
  const [errors, setErrors] = useState<StepErrors<'name' | 'repo' | 'mode'>>(noErrors);

  // The first connection that lists a repo owns it.
  const owners = new Map<string, string>();
  const repos: { name: string; meta: string }[] = [];
  usable.forEach((c, i) => {
    for (const r of repoLists[i]?.data ?? []) {
      if (owners.has(r.repoPath)) continue;
      owners.set(r.repoPath, c.id);
      repos.push({ name: r.repoPath, meta: repoMeta(r) });
    }
  });
  // Revisited: the repository is fixed once the project exists.
  const shown = project ? [{ name: project.repoPath, meta: 'Connected to this project' }] : repos;
  const selected = project?.repoPath ?? shown[0]?.name ?? '';
  const installedOn = (project ? connections.filter((c) => c.id === project.codeConnectionId) : usable)
    .map((c) => c.accountName)
    .join(', ');
  const heard = progress ? triggerProgress(progress, now) : {};

  const onContinue = async (d: Setup1Draft) => {
    setErrors(noErrors);
    const settings = {
      ...(d.name.trim() !== '' && { name: d.name.trim() }),
      triggerMode: d.mode,
      ...(d.mode === 'polling' && { pollIntervalSeconds: pollSeconds(d.interval) }),
    };
    const owner = owners.get(d.repo);
    try {
      let saved: ProjectDto;
      if (project) saved = await save.mutateAsync({ kind: 'update', project, body: settings });
      else if (owner) {
        saved = await save.mutateAsync({
          kind: 'create',
          body: { ...settings, connectionId: owner, repoPath: d.repo },
        });
      } else {
        setErrors({ fields: { repo: 'Pick a repository.' } });
        return;
      }
      await goTo('agent', saved);
    } catch (e) {
      setErrors(stepErrors(e, REPO_POINTERS));
    }
  };

  const onConnect = async () => {
    try {
      const { url } = await install.mutateAsync('github');
      browserLocation.assign(url);
    } catch (e) {
      toast.show(toastFromError(e));
    }
  };

  return (
    <Setup1
      key={project?.id ?? 'new'}
      user={user}
      projectName={project?.name ?? repoName(selected)}
      repos={shown}
      selected={selected}
      installedOn={installedOn}
      mode={project?.triggerMode ?? 'webhook'}
      pollInterval={project ? pollIntervalLabel(project.pollIntervalSeconds) : undefined}
      pingAt={heard.pingAt}
      polling={heard.polling}
      onCheckAgain={projectId ? () => void refetchProgress() : undefined}
      onConnect={() => void onConnect()}
      onContinue={(d) => void onContinue(d)}
      saving={save.isPending}
      errors={errors.fields}
      formError={errors.form}
    />
  );
}

const AGENT_POINTERS = {
  '/value': 'credential',
  '/type': 'credential',
  '/model': 'model',
  '/maxConcurrentRuns': 'maxConcurrent',
} as const;

const MODELS = ['opus', 'sonnet'];

function AgentStep({ org, projectId }: { org: string; projectId: string }) {
  const user = useActor();
  const goTo = useGoToStep(org);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  const { save, pending } = useSaveAgentStep(org);
  const [errors, setErrors] = useState<StepErrors<'credential' | 'model' | 'maxConcurrent'>>(noErrors);
  const models = MODELS.includes(agent.model) ? MODELS : [agent.model, ...MODELS];

  const onContinue = async (d: Setup2Draft) => {
    const max = /^\d+$/.test(d.maxConcurrent.trim()) ? Number(d.maxConcurrent.trim()) : NaN;
    const fields: StepErrors<'credential' | 'maxConcurrent'>['fields'] = {};
    if (d.credential === '' && !agent.credential.set) fields.credential = 'Paste the token to continue.';
    if (!(max >= 1 && max <= 10)) fields.maxConcurrent = 'Enter a whole number from 1 to 10.';
    setErrors({ fields });
    if (Object.keys(fields).length > 0) return;
    try {
      const saved = await save(project, agent, {
        model: d.model,
        maxConcurrentRuns: max,
        credentialType: d.credentialType,
        credential: d.credential,
      });
      await goTo('skills', saved);
    } catch (e) {
      setErrors(stepErrors(e, AGENT_POINTERS));
    }
  };

  return (
    <Setup2
      user={user}
      projectName={project.name}
      repo={project.repoPath}
      credentialType={agent.credential.type ?? 'oauth_token'}
      secretState="entering"
      models={models}
      model={agent.model}
      maxConcurrent={project.maxConcurrentRuns}
      backHref={stepHref(org, 'repo', projectId)}
      onContinue={(d) => void onContinue(d)}
      saving={pending}
      errors={errors.fields}
      formError={errors.form}
    />
  );
}

const SKILLS_POINTERS = { '/message': 'message' } as const;

function SkillsStep({ org, projectId }: { org: string; projectId: string }) {
  const user = useActor();
  const goTo = useGoToStep(org);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  const save = useSaveSkillsStep(org);
  const [errors, setErrors] = useState<StepErrors<'message'>>(noErrors);
  const templates = SKILL_TEMPLATES.map(({ name, description, note }) => ({ name, description, note }));
  const names = templates.map((t) => t.name);

  const run = async (picked: string[], message: string) => {
    setErrors(noErrors);
    try {
      await goTo('rules', await save.mutateAsync({ project, names: picked, message }));
    } catch (e) {
      setErrors(stepErrors(e, SKILLS_POINTERS));
    }
  };

  return (
    <Setup3
      user={user}
      projectName={project.name}
      repo={project.repoPath}
      branch="main"
      templates={templates}
      selected={names}
      commitMessage={`Add Agent Desk skills: ${names.join(', ')}`}
      credentialDetail={credentialDetail(agent)}
      backHref={stepHref(org, 'agent', projectId)}
      onContinue={(d) => void run(d.names, d.message)}
      onSkip={() => void run([], '')}
      saving={save.isPending}
      errors={errors.fields}
      formError={errors.form}
    />
  );
}

const RULE_POINTERS = {
  '/command': 'command',
  '/labelFilter': 'labels',
  '/target': 'target',
  '/skillName': 'skill',
} as const;

const FOLLOW_UP = { command: 'code-review', target: 'pr', skill: 'code-review', enabled: true } as const;

function RulesStep({ org, projectId }: { org: string; projectId: string }) {
  const user = useActor();
  const goTo = useGoToStep(org);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  const { data: skills } = useSuspenseQuery(setupQueries.skills(org, projectId));
  const save = useSaveRulesStep(org);
  const [errors, setErrors] = useState<StepErrors<'command' | 'labels' | 'target' | 'skill'>>(noErrors);
  const skillNames = skills.map((s) => s.name);
  const rule: RuleDraft = {
    command: 'code-build',
    target: 'issue',
    labels: ['user-story'],
    skill: skillNames.includes('code-build') ? 'code-build' : skillNames[0] ?? 'code-build',
    agent: agent.name,
    enabled: true,
  };

  const onContinue = async ({ rule: r, followUp }: { rule: RuleDraft; followUp: boolean }) => {
    setErrors(noErrors);
    const toRequest = (d: {
      command: string;
      target: RuleDraft['target'];
      labels: string[];
      skill: string;
      enabled: boolean;
    }) => ({
      command: d.command.replace(/^\//, ''),
      labelFilter: d.labels,
      target: d.target,
      skillName: d.skill,
      enabled: d.enabled,
    });
    const rules = [toRequest(r), ...(followUp ? [toRequest({ ...FOLLOW_UP, labels: [] })] : [])];
    try {
      await goTo('ready', await save.mutateAsync({ project, rules }));
    } catch (e) {
      if (e instanceof RuleSaveError && e.index === 0) setErrors(stepErrors(e.cause, RULE_POINTERS));
      else if (e instanceof RuleSaveError) {
        const { form, fields } = stepErrors(e.cause, {});
        setErrors({
          fields: {},
          form: `The /${FOLLOW_UP.command} rule was not saved: ${form ?? Object.values(fields).join(' ')}`,
        });
      } else setErrors(stepErrors(e, {}));
    }
  };

  return (
    <Setup4
      user={user}
      projectName={project.name}
      repo={project.repoPath}
      rule={rule}
      skills={skillNames}
      followUp={FOLLOW_UP}
      maxRunsPerTicket={project.maxRunsPerTicket}
      agentModel={agent.model}
      credentialDetail={credentialDetail(agent)}
      backHref={stepHref(org, 'skills', projectId)}
      onContinue={(d) => void onContinue(d)}
      saving={save.isPending}
      errors={errors.fields}
      formError={errors.form}
    />
  );
}

function ReadyStep({ org, projectId }: { org: string; projectId: string }) {
  const user = useActor();
  const now = useNow();
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  const { data: skills } = useSuspenseQuery(setupQueries.skills(org, projectId));
  const { data: rules } = useSuspenseQuery(setupQueries.rules(org, projectId));
  const { data: connection } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const first = rules[0];
  const label = first?.labelFilter[0];
  const skillList = skills.map((s) => s.name).join(', ');
  const summary = [
    { term: 'Repository', value: <span className="mono">{project.repoPath}</span> },
    {
      term: connectionCopy.triggerTerm,
      value: connectionCopy.triggerSummary(project.triggerMode, pollIntervalLabel(project.pollIntervalSeconds)),
    },
    { term: 'Agent', value: agentSummary(agent, project.maxConcurrentRuns) },
    { term: 'Skills', value: skillList ? <span className="mono">{skillList}</span> : 'None' },
    {
      term: 'Rules',
      value:
        rules.length === 0
          ? 'None'
          : rules.map((r, i) => (
              <span key={r.id}>
                {i > 0 && '; '}
                <CommandChip>/{r.command}</CommandChip> {ruleWhere(r)}
              </span>
            )),
    },
  ];
  return (
    <SetupReady
      user={user}
      projectName={project.name}
      repo={project.repoPath}
      label={label ? { name: label } : undefined}
      command={`/${first?.command ?? 'code-build'}`}
      summary={summary}
      lastEvent={lastEvent(connection, now)}
      skills={skillList}
      credentialDetail={credentialDetail(agent)}
      runsHref={`/o/${encodeURIComponent(org)}/p/${encodeURIComponent(projectId)}/runs`}
    />
  );
}
