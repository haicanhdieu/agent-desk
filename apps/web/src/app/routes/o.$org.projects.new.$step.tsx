import {
  AGENT_KIND_CAPABILITIES,
  AGENT_KINDS_COMING_SOON,
  AgentKind,
  type ConnectionDto,
  type CreateRuleRequest,
  type ProjectDto,
} from '@agentdesk/contracts';
import { useQuery, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, redirect, useLocation, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import type { ProviderPickerOption, RuleDraft } from '@/components';
import { toModelList } from '@/components/ModelPicker';
import { CommandChip, useToast } from '@/ds';
import { useAppBar } from '@/features/chrome/appBar';
import { pollIntervalLabel } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { REFRESH_ERROR } from '@/features/desk/agent.form';
import { requirePermission, useCan } from '@/features/access/guards';
import { projectPaths } from '@/features/desk/frame';
import { deskQueries } from '@/features/desk/queries';
import { usePromptPreview } from '@/features/desk/promptPreview';
import { setupQueries as scriptQueries } from '@/features/setup-script/queries';
import { useSetupWarning } from '@/features/setup-script/useSetupWarning';
import { WorkspaceStep } from '@/features/setup/WorkspaceStep';
import { browserLocation, safeInstallUrl } from '@/features/setup/location';
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
  CredentialRefreshError,
  RuleSaveError,
  stepErrors,
  useInstallConnection,
  useReconnectGithub,
  useRefreshRepositories,
  useSaveAgentStep,
  useSaveRepoStep,
  useSaveRulesStep,
  useSaveSkillsStep,
  type StepErrors,
} from '@/features/setup/mutations';
import { setupQueries } from '@/features/setup/queries';
import { isProviderReauthRequired } from '@/features/setup/reauth';
import { resolveStep } from '@/features/setup/resume';
import { SetupSearch, SetupStepParam } from '@/features/setup/steps';
import { SKILL_TEMPLATES } from '@/features/setup/templates';
import { connectionCopy } from '@/mocks/connection';
import type { AgentKindView } from '@/mocks/types';
import { Setup1, Setup2, Setup3, Setup4, SetupReady, type Setup1Draft, type Setup2Draft } from '@/screens';

// Setup (spec §4.5): one route per step, each saving on Continue. Which step shows comes only from the server's
// `project.setupStep` (via `?project=`): asking for a later step than the project has reached redirects there.

export const Route = createFileRoute('/o/$org/projects/new/$step')({
  validateSearch: (search) => SetupSearch.parse(search),
  beforeLoad: async ({ context: { queryClient }, params, search }) => {
    // Creating a project is org-level `project:create`; refused before the step is read or anything is requested.
    await requirePermission(queryClient, params.org, 'project:create');
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
      ...(step === 'setup' ? [ensure(scriptQueries.script(org, projectId))] : []),
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

/** The connection's installation settings page, only when it is an https URL the app may open. */
function manageLink(c: ConnectionDto | undefined): string | undefined {
  return (c?.manageUrl && safeInstallUrl(c.manageUrl)) || undefined;
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
    case 'setup':
      return <WorkspaceSetupStep org={org} projectId={projectId} />;
    case 'skills':
      return <SkillsStep org={org} projectId={projectId} />;
    case 'rules':
      return <RulesStep org={org} projectId={projectId} />;
    case 'ready':
      return <ReadyStep org={org} projectId={projectId} />;
  }
}

type LaterStep = 'agent' | 'setup' | 'skills' | 'rules' | 'ready';

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
  const bar = useAppBar(org);
  const now = useNow();
  const toast = useToast();
  const goTo = useGoToStep(org);
  const navigate = useNavigate();
  const { data: project } = useQuery({ ...projectsQueries.detail(org, projectId ?? ''), enabled: !!projectId });
  const { data: progress, refetch: refetchProgress } = useQuery({
    ...projectsQueries.connection(org, projectId ?? ''),
    enabled: !!projectId,
  });
  const { data: connections } = useSuspenseQuery(setupQueries.connections(org));
  const usable = usableConnections(connections, connectionId);
  // Overrides the global no-refetch-on-focus default: the list is GitHub's and changes in another tab. The stale time
  // still applies, and it is only wanted while the list is shown (no project yet).
  const repoLists = useSuspenseQueries({
    queries: usable.map((c) => ({ ...setupQueries.repos(org, c.id), refetchOnWindowFocus: !projectId })),
  });
  const save = useSaveRepoStep(org);
  const install = useInstallConnection(org);
  const refresh = useRefreshRepositories(org);
  const reconnect = useReconnectGithub();
  const here = useLocation({ select: (l) => l.href });
  // The GitHub account behind this page has no usable token any more: retrying cannot help, signing in again can.
  const [reconnectNeeded, setReconnectNeeded] = useState(false);
  const failed = (e: unknown) => {
    if (isProviderReauthRequired(e)) setReconnectNeeded(true);
    else toast.show(toastFromError(e));
  };
  const onReconnect = () => {
    reconnect.mutate(here, { onError: (e) => toast.show(toastFromError(e)) });
  };
  // The repository list is GitHub's: it changes in another tab, so it is read again on return and on request.
  const refreshRepos = async () => {
    if (refresh.isPending) return;
    try {
      await refresh.mutateAsync();
      setReconnectNeeded(false);
      // Back from an install, the page showed only that connection; a refresh lists every installation.
      if (connectionId !== undefined) {
        await navigate({
          to: '/o/$org/projects/new/$step',
          params: { org, step: 'repo' },
          search: projectId ? { project: projectId } : {},
          replace: true,
        });
      }
    } catch (e) {
      failed(e);
    }
  };
  const [errors, setErrors] = useState<StepErrors<'name' | 'repo' | 'mode'>>(noErrors);

  // The first connection that lists a repo owns it.
  const owners = new Map<string, string>();
  const repos: { name: string; meta: string; manageUrl?: string }[] = [];
  usable.forEach((c, i) => {
    const manageUrl = manageLink(c);
    for (const r of repoLists[i]?.data ?? []) {
      if (owners.has(r.repoPath)) continue;
      owners.set(r.repoPath, c.id);
      repos.push({ name: r.repoPath, meta: repoMeta(r), ...(manageUrl && { manageUrl }) });
    }
  });
  // Revisited: the repository is fixed once the project exists.
  const projectManageUrl = project ? manageLink(connections.find((c) => c.id === project.codeConnectionId)) : undefined;
  const shown = project
    ? [
        {
          name: project.repoPath,
          meta: 'Connected to this project',
          ...(projectManageUrl && { manageUrl: projectManageUrl }),
        },
      ]
    : repos;
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
        // The history entry of this step now names the project, so Back from `agent` updates it instead of
        // creating the same repo again (409).
        await navigate({
          to: '/o/$org/projects/new/$step',
          params: { org, step: 'repo' },
          search: { project: saved.id },
          replace: true,
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
    // Opened now, in the click, and pointed at GitHub once the API has answered: a tab opened after the wait is blocked.
    const tab = browserLocation.openPendingTab();
    try {
      const outcome = await install.mutateAsync('github');
      if (outcome.kind === 'linked') {
        tab.close();
        await navigate({
          to: '/o/$org/projects/new/$step',
          params: { org, step: 'repo' },
          search: { connection: outcome.connection.id },
          replace: true,
        });
        return;
      }
      const target = safeInstallUrl(outcome.url);
      if (!target) {
        tab.close();
        setErrors({
          fields: {},
          form: 'The install link from the server is not a valid https address. Try again later.',
        });
        return;
      }
      tab.go(target);
    } catch (e) {
      tab.close();
      failed(e);
    }
  };

  return (
    <Setup1
      key={project?.id ?? 'new'}
      user={bar.user}
      org={bar.org}
      projectName={project?.name ?? repoName(selected)}
      repos={shown}
      selected={selected}
      installedOn={installedOn}
      accessHref={usable.map(manageLink).find((u) => u !== undefined)}
      mode={project?.triggerMode ?? 'webhook'}
      pollInterval={project ? pollIntervalLabel(project.pollIntervalSeconds) : undefined}
      pingAt={heard.pingAt}
      polling={heard.polling}
      onCheckAgain={projectId ? () => void refetchProgress() : undefined}
      onConnect={() => void onConnect()}
      onRefresh={project ? undefined : () => void refreshRepos()}
      refreshing={refresh.isPending}
      reconnectRequired={reconnectNeeded}
      onReconnect={onReconnect}
      reconnecting={reconnect.isPending}
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
  '/baseUrl': 'baseUrl',
  '/maxConcurrentRuns': 'maxConcurrent',
} as const;

const AGENT_KIND_VIEWS: AgentKindView[] = AgentKind.options.map((kind) => ({
  kind,
  ...AGENT_KIND_CAPABILITIES[kind],
}));

/**
 * The picker's cards. Until the wizard can swap the placeholder (Task 31) only the project's own agent is
 * choosable; the other runnable kinds show as chips.
 */
function agentProviders(current: string): ProviderPickerOption[] {
  return [
    ...AGENT_KIND_VIEWS.map((k) => ({ kind: k.kind, label: k.label, logo: k.logo, available: k.kind === current })),
    ...AGENT_KINDS_COMING_SOON.map((c) => ({ kind: c.id, label: c.label, logo: c.logo, available: false })),
  ];
}

function AgentStep({ org, projectId }: { org: string; projectId: string }) {
  const bar = useAppBar(org);
  const goTo = useGoToStep(org);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  const { save, pending } = useSaveAgentStep(org);
  const [errors, setErrors] = useState<StepErrors<'credential' | 'model' | 'maxConcurrent' | 'baseUrl'>>(noErrors);
  const models = useQuery(deskQueries.agentModels(org, agent.id));

  const onContinue = async (d: Setup2Draft) => {
    const max = /^\d+$/.test(d.maxConcurrent.trim()) ? Number(d.maxConcurrent.trim()) : NaN;
    const fields: StepErrors<'credential' | 'maxConcurrent' | 'baseUrl'>['fields'] = {};
    // The address is sent only when it changed, and only together with a token ('' clears it: provider default).
    const addressChanged = d.baseUrl !== (agent.baseUrl ?? '');
    if (d.credential === '' && !agent.credential.set) fields.credential = 'Paste the token to continue.';
    else if (d.credential === '' && addressChanged) fields.baseUrl = 'Paste the token again to change the API address.';
    if (!(max >= 1 && max <= 10)) fields.maxConcurrent = 'Enter a whole number from 1 to 10.';
    setErrors({ fields });
    if (Object.keys(fields).length > 0) return;
    try {
      const saved = await save(project, agent, {
        model: d.model,
        maxConcurrentRuns: max,
        credentialType: d.credentialType ?? 'oauth_token',
        credential: d.credential,
        ...(d.credential !== '' && addressChanged && { baseUrl: d.baseUrl === '' ? null : d.baseUrl }),
      });
      await goTo('setup', saved);
    } catch (e) {
      if (e instanceof CredentialRefreshError) {
        const written = e.writeError === undefined ? { fields: {} } : stepErrors(e.writeError, AGENT_POINTERS);
        setErrors({ fields: written.fields, form: [written.form, REFRESH_ERROR].filter(Boolean).join(' ') });
      } else setErrors(stepErrors(e, AGENT_POINTERS));
    }
  };

  return (
    <Setup2
      user={bar.user}
      org={bar.org}
      projectName={project.name}
      repo={project.repoPath}
      kinds={AGENT_KIND_VIEWS}
      providers={agentProviders(agent.provider)}
      savedProvider={agent.credential.set ? agent.provider : undefined}
      credentialType={agent.credential.type ?? undefined}
      credentialSaved={agent.credential.set}
      secretState="entering"
      modelList={toModelList(models, agent.baseUrl)}
      baseUrl={agent.baseUrl ?? ''}
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

function WorkspaceSetupStep({ org, projectId }: { org: string; projectId: string }) {
  const bar = useAppBar(org);
  const goTo = useGoToStep(org);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  return (
    <WorkspaceStep
      org={org}
      project={project}
      bar={bar}
      credentialDetail={credentialDetail(agent)}
      backHref={stepHref(org, 'agent', projectId)}
      onDone={(saved) => void goTo('skills', saved)}
    />
  );
}

const SKILLS_POINTERS = { '/message': 'message' } as const;

function SkillsStep({ org, projectId }: { org: string; projectId: string }) {
  const bar = useAppBar(org);
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
      user={bar.user}
      org={bar.org}
      projectName={project.name}
      repo={project.repoPath}
      branch="main"
      templates={templates}
      selected={names}
      commitMessage={`Add Agent Desk skills: ${names.join(', ')}`}
      credentialDetail={credentialDetail(agent)}
      backHref={stepHref(org, 'setup', projectId)}
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
  '/prompt': 'prompt',
  '/model': 'model',
} as const;

const FOLLOW_UP = { command: 'code-review', target: 'pr', skill: 'code-review', enabled: true } as const;
const MODEL_REQUIRED = 'Enter a model name.';

function RulesStep({ org, projectId }: { org: string; projectId: string }) {
  const bar = useAppBar(org);
  const goTo = useGoToStep(org);
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  const { data: skills } = useSuspenseQuery(setupQueries.skills(org, projectId));
  const save = useSaveRulesStep(org);
  const [errors, setErrors] =
    useState<StepErrors<'command' | 'labels' | 'target' | 'skill' | 'prompt' | 'model'>>(noErrors);
  const models = useQuery(deskQueries.agentModels(org, agent.id));
  const promptPreview = usePromptPreview(org, projectId, true);
  const skillNames = skills.items.map((s) => s.name);
  const rule: RuleDraft = {
    command: 'code-build',
    target: 'issue',
    labels: ['user-story'],
    skill: skillNames.includes('code-build') ? 'code-build' : (skillNames[0] ?? 'code-build'),
    agentId: agent.id,
    agentLabel: agent.name,
    model: null,
    enabled: true,
  };

  const onContinue = async ({ rule: r, followUp }: { rule: RuleDraft; followUp: boolean }) => {
    setErrors(noErrors);
    // An Other model… with nothing typed is not saveable.
    if (r.model?.trim() === '') {
      setErrors({ fields: { model: MODEL_REQUIRED } });
      return;
    }
    const toRequest = (d: {
      command: string;
      target: RuleDraft['target'];
      labels: string[];
      skill: string;
      enabled: boolean;
      model?: string | null;
      kind?: RuleDraft['kind'];
      prompt?: string;
    }): CreateRuleRequest => {
      const common = {
        command: d.command.replace(/^\//, ''),
        labelFilter: d.labels,
        target: d.target,
        enabled: d.enabled,
        model: d.model == null ? null : d.model.trim(),
      };
      return d.kind === 'prompt'
        ? { ...common, kind: 'prompt', prompt: d.prompt ?? '' }
        : { ...common, kind: 'skill', skillName: d.skill };
    };
    const rules = [toRequest(r), ...(followUp ? [toRequest({ ...FOLLOW_UP, labels: [], model: null })] : [])];
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

  // Skipping creates no rule; it only marks setup ready.
  const onSkip = async () => {
    setErrors(noErrors);
    try {
      await goTo('ready', await save.mutateAsync({ project, rules: [] }));
    } catch (e) {
      setErrors(stepErrors(e, {}));
    }
  };

  return (
    <Setup4
      user={bar.user}
      org={bar.org}
      projectName={project.name}
      repo={project.repoPath}
      rule={rule}
      skills={skillNames}
      modelList={toModelList(models, agent.baseUrl)}
      promptPreview={promptPreview}
      followUp={FOLLOW_UP}
      maxRunsPerTicket={project.maxRunsPerTicket}
      credentialDetail={credentialDetail(agent)}
      backHref={stepHref(org, 'skills', projectId)}
      onContinue={(d) => void onContinue(d)}
      onSkip={() => void onSkip()}
      saving={save.isPending}
      errors={errors.fields}
      formError={errors.form}
    />
  );
}

function ReadyStep({ org, projectId }: { org: string; projectId: string }) {
  const bar = useAppBar(org);
  const now = useNow();
  const { data: project } = useSuspenseQuery(projectsQueries.detail(org, projectId));
  const { data: agent } = useSuspenseQuery(setupQueries.agent(org, projectId));
  const { data: skills } = useSuspenseQuery(setupQueries.skills(org, projectId));
  const { data: rulesPage } = useSuspenseQuery(setupQueries.rules(org, projectId));
  const rules = rulesPage.items;
  const { data: connection } = useSuspenseQuery(projectsQueries.connection(org, projectId));
  const warning = useSetupWarning(org, projectId, useCan(org, 'setup:read', { projectId }));
  const canAddRule = useCan(org, 'rule:create', { projectId });
  const first = rules[0];
  const label = first?.labelFilter[0];
  const skillList = skills.items.map((s) => s.name).join(', ');
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
      user={bar.user}
      org={bar.org}
      projectName={project.name}
      repo={project.repoPath}
      label={label ? { name: label } : undefined}
      command={first ? `/${first.command}` : undefined}
      summary={summary}
      lastEvent={lastEvent(connection, now)}
      skills={skillList}
      credentialDetail={credentialDetail(agent)}
      runsHref={`/o/${encodeURIComponent(org)}/p/${encodeURIComponent(projectId)}/runs`}
      rulesHref={projectPaths(org, projectId).rules}
      canAddRule={canAddRule}
      {...(warning && {
        warning: { title: warning.title, detail: warning.detail, href: projectPaths(org, projectId).setup },
      })}
    />
  );
}
