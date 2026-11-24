import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { CommandChip } from '@/ds';
import {
  agentSettings,
  connectionCopy,
  promptSystemLines,
  rules,
  setupPlugins,
  setupScript,
  skillTemplates,
  TRIAGE_PROMPT,
  user,
} from '@/mocks';
import { Setup1 as Setup1Screen } from './Setup1';
import { Setup2 as Setup2Screen } from './Setup2';
import { Setup3 as Setup3Screen } from './Setup3';
import { toModelList } from '@/components';
import { agentModelsFixtures } from '@/mocks/dto/agentModels';
import { Setup4 as Setup4Screen } from './Setup4';
import { SetupReady as SetupReadyScreen } from './SetupReady';
import { SetupWorkspace as SetupWorkspaceScreen } from './SetupWorkspace';
import { viewport } from './viewports';

// Artboards come from canvas.json: Setup1, Setup1Polling, Setup1PollingOk, SetupWorkspace 1440x1000; the rest 1440x900.
// SetupLayout renders its own top bar and the single <main>.
const meta = {
  title: 'Screens/Setup',
  globals: viewport(1440, 900),
  parameters: { layout: 'fullscreen', artboardHeight: 900 },
  decorators: [
    (S, ctx) => {
      const h = ctx.parameters.artboardHeight as number;
      return (
        <div style={{ width: 1440, height: h }}>
          <AppShell height={h} topBar={null}>
            <S />
          </AppShell>
        </div>
      );
    },
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The org bar of an owner or admin: the Projects tab (active) and the Settings tab. */
const harbor = { id: 'org-harbor', slug: 'harbor-labs', name: 'Harbor Labs' };
const bar = {
  account: { name: 'Kim Hale', handle: 'kim-hale', invitationsHref: '#invitations' },
  org: {
    current: harbor,
    orgs: [harbor],
    platformAdmin: false,
    orgHref: (o: { slug: string }) => `/o/${o.slug}/projects`,
    createHref: '/orgs/new',
    projectsHref: '#projects',
    settingsHref: '#settings',
  },
};

const tall = { parameters: { artboardHeight: 1000 }, globals: viewport(1440, 1000) };

const repo = 'harbor-labs/invoicer-api';
const projectName = 'invoicer-api';
const rule = rules[0];

const setup1 = {
  user,
  ...bar,
  projectName,
  repos: [
    { name: repo, meta: 'Private, updated 2 hours ago' },
    { name: 'harbor-labs/invoicer-web', meta: 'Private, updated yesterday' },
    { name: 'harbor-labs/infra-k8s', meta: 'Private, updated 5 days ago' },
  ],
  selected: repo,
  installedOn: 'harbor-labs',
  nextHref: '#',
};

export const Setup1: Story = {
  name: 'Setup 1, connect repository, webhook',
  ...tall,
  render: () => <Setup1Screen {...setup1} pingAt="14:01:37" />,
};

export const Setup1Polling: Story = {
  name: 'Setup 1, polling, first check',
  ...tall,
  render: () => <Setup1Screen {...setup1} mode="polling" polling={{ state: 'checking' }} />,
};

export const Setup1PollingOk: Story = {
  name: 'Setup 1, polling connected',
  ...tall,
  render: () => <Setup1Screen {...setup1} mode="polling" polling={{ state: 'ok', lastChecked: '20s ago' }} />,
};

export const Setup1RefreshRepos: Story = {
  name: 'Setup 1, refresh repositories',
  ...tall,
  render: () => <Setup1Screen {...setup1} pingAt="14:01:37" onRefresh={() => undefined} />,
};

export const Setup1Refreshing: Story = {
  name: 'Setup 1, refreshing repositories',
  ...tall,
  render: () => <Setup1Screen {...setup1} pingAt="14:01:37" onRefresh={() => undefined} refreshing />,
};

export const Setup1PollingFailed: Story = {
  name: 'Setup 1, polling failed',
  ...tall,
  render: () => (
    <Setup1Screen
      {...setup1}
      mode="polling"
      polling={{ state: 'failed', reason: connectionCopy.reasons.tokenRevoked }}
    />
  ),
};

export const Setup2: Story = {
  name: 'Setup 2, Claude credential',
  render: () => (
    <Setup2Screen
      user={user}
      {...bar}
      projectName={projectName}
      repo={repo}
      credentialType={agentSettings.credential.type}
      secretState="entering"
      modelList={toModelList({ status: 'success', data: agentModelsFixtures.live }, null)}
      maxConcurrent={agentSettings.maxConcurrent}
      accepted={{ at: '14:03:02', secretName: 'agentdesk/proj-invoicer-api-claude' }}
    />
  ),
};

/** No credential yet: the standard names with the reason note. */
export const Setup2Fallback: Story = {
  name: 'Setup 2, Claude credential, no credential yet',
  render: () => (
    <Setup2Screen
      user={user}
      {...bar}
      projectName={projectName}
      repo={repo}
      credentialType={agentSettings.credential.type}
      secretState="entering"
      modelList={toModelList({ status: 'success', data: agentModelsFixtures.noCredential }, null)}
      maxConcurrent={agentSettings.maxConcurrent}
    />
  ),
};

const workspace = { user, ...bar, projectName, repo, plugins: { plugins: setupPlugins.planned } };

/** New optional step between the credential and skills (five steps once it ships). */
export const SetupWorkspace: Story = {
  name: 'Setup, prepare workspace, test passed',
  ...tall,
  render: () => (
    <SetupWorkspaceScreen
      {...workspace}
      script={setupScript}
      test={{
        state: 'passed',
        title: 'Test passed in 2m 41s',
        detail: 'Clone, 2 plugins installed, 1 blocked, setup exited 0. The test workspace stays up 13 more minutes.',
      }}
    />
  ),
};

export const SetupWorkspaceStart: Story = {
  name: 'Setup, prepare workspace, not tested',
  ...tall,
  render: () => <SetupWorkspaceScreen {...workspace} />,
};

export const SetupWorkspaceRunning: Story = {
  name: 'Setup, prepare workspace, test running',
  ...tall,
  render: () => (
    <SetupWorkspaceScreen
      {...workspace}
      script={setupScript}
      test={{ state: 'running', detail: 'Plugins done. Running the setup script, 21s so far.' }}
    />
  ),
};

export const SetupWorkspaceFailed: Story = {
  name: 'Setup, prepare workspace, test failed',
  ...tall,
  render: () => (
    <SetupWorkspaceScreen
      {...workspace}
      script={setupScript}
      test={{
        state: 'failed',
        title: 'Setup failed: exit 1 after 48s',
        detail:
          'dotnet restore could not reach a package feed. Open the terminal to look around; you can still continue.',
      }}
    />
  ),
};

export const Setup3: Story = {
  name: 'Setup 3, skills',
  render: () => (
    <Setup3Screen
      user={user}
      {...bar}
      projectName={projectName}
      repo={repo}
      branch="main"
      templates={skillTemplates}
      selected={skillTemplates.map((t) => t.name)}
      commitMessage="Add Agent Desk skills: code-build, code-review"
    />
  ),
};

const liveModels = toModelList({ status: 'success', data: agentModelsFixtures.live }, null);

export const Setup4: Story = {
  name: 'Setup 4, first rule',
  render: () => (
    <Setup4Screen
      user={user}
      {...bar}
      projectName={projectName}
      repo={repo}
      rule={rule}
      skills={['code-build', 'code-review']}
      followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={{ state: 'ready', systemLines: promptSystemLines }}
      modelList={liveModels}
    />
  ),
};

/** The first rule as a custom prompt (state of board Setup4; taller so the system lines fit). */
export const Setup4Prompt: Story = {
  name: 'Setup 4, first rule as a custom prompt',
  parameters: { artboardHeight: 1080 },
  globals: viewport(1440, 1080),
  render: () => (
    <Setup4Screen
      user={user}
      {...bar}
      projectName={projectName}
      repo={repo}
      rule={{ ...rule, command: 'triage', labels: [], skill: '', kind: 'prompt', prompt: TRIAGE_PROMPT }}
      skills={['code-build', 'code-review']}
      followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
      promptPreview={{ state: 'ready', systemLines: promptSystemLines }}
      modelList={liveModels}
    />
  ),
};

const readySummary = (trigger: string) => [
  { term: 'Repository', value: <span className="mono">{repo}</span> },
  { term: connectionCopy.triggerTerm, value: trigger },
  { term: 'Agent', value: 'Claude, opus, 30 min limit, 2 at a time' },
  { term: 'Skills', value: <span className="mono">code-build, code-review</span> },
  {
    term: 'Rules',
    value: (
      <>
        <CommandChip>/code-build</CommandChip> on issues labelled user-story; <CommandChip>/code-review</CommandChip> on
        pull requests
      </>
    ),
  },
];

const ready = {
  user,
  ...bar,
  projectName,
  repo,
  label: { name: 'user-story', color: '#7C8FD8' },
  command: '/code-build',
};

export const SetupReady: Story = {
  name: 'Setup, ready',
  render: () => (
    <SetupReadyScreen
      {...ready}
      lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
      summary={readySummary(connectionCopy.triggerSummary('webhook'))}
    />
  ),
};

export const SetupReadyWithWarning: Story = {
  name: 'Setup, ready, setup warning',
  render: () => (
    <SetupReadyScreen
      {...ready}
      lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
      summary={readySummary(connectionCopy.triggerSummary('webhook'))}
      warning={{
        title: 'The last workspace setup test failed',
        detail: 'Runs still start, but setup may fail in them. Open Workspace setup to see the log.',
        href: '#',
      }}
    />
  ),
};

export const SetupReadyPolling: Story = {
  name: 'Setup, ready, polling',
  render: () => (
    <SetupReadyScreen
      {...ready}
      lastEvent={{ mode: 'polling', at: '20s ago' }}
      summary={readySummary(connectionCopy.triggerSummary('polling'))}
    />
  ),
};

export const SetupReadyNoRule: Story = {
  name: 'Setup, ready, no rule',
  render: () => (
    <SetupReadyScreen
      {...ready}
      command={undefined}
      label={undefined}
      lastEvent={{ mode: 'webhook', at: 'ping, 14:01:37' }}
      summary={readySummary(connectionCopy.triggerSummary('webhook'))}
    />
  ),
};
