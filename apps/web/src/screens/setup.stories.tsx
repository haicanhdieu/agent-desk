import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { CommandChip } from '@/ds';
import { agentSettings, connectionCopy, rules, setupPlugins, setupScript, skillTemplates, user } from '@/mocks';
import { Setup1 as Setup1Screen } from './Setup1';
import { Setup2 as Setup2Screen } from './Setup2';
import { Setup3 as Setup3Screen } from './Setup3';
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

const tall = { parameters: { artboardHeight: 1000 }, globals: viewport(1440, 1000) };

const repo = 'harbor-labs/invoicer-api';
const projectName = 'invoicer-api';
const rule = rules[0];

const setup1 = {
  user,
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
      projectName={projectName}
      repo={repo}
      credentialType={agentSettings.credential.type}
      secretState="entering"
      models={['opus (latest Opus)', 'sonnet (latest Sonnet)', 'Custom model id']}
      maxConcurrent={agentSettings.maxConcurrent}
      accepted={{ at: '14:03:02', secretName: 'agentdesk/proj-invoicer-api-claude' }}
    />
  ),
};

const workspace = { user, projectName, repo, plugins: { plugins: setupPlugins.planned } };

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
      projectName={projectName}
      repo={repo}
      branch="main"
      templates={skillTemplates}
      selected={skillTemplates.map((t) => t.name)}
      commitMessage="Add Agent Desk skills: code-build, code-review"
    />
  ),
};

export const Setup4: Story = {
  name: 'Setup 4, first rule',
  render: () => (
    <Setup4Screen
      user={user}
      projectName={projectName}
      repo={repo}
      rule={rule}
      skills={['code-build', 'code-review']}
      followUp={{ command: 'code-review', target: 'pr', skill: 'code-review', enabled: true }}
      maxRunsPerTicket={agentSettings.maxRunsPerTicket}
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
