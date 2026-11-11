import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@/components';
import { CommandChip } from '@/ds';
import { agentSettings, rules, skillTemplates, user } from '@/mocks';
import { Setup1 as Setup1Screen } from './Setup1';
import { Setup2 as Setup2Screen } from './Setup2';
import { Setup3 as Setup3Screen } from './Setup3';
import { Setup4 as Setup4Screen } from './Setup4';
import { SetupReady as SetupReadyScreen } from './SetupReady';

// Artboard is 1440x900 (canvas.json). SetupLayout renders its own top bar and the single <main>.
const meta = {
  title: 'Screens/Setup',
  parameters: { layout: 'fullscreen' },
  decorators: [(S) => <div style={{ width: 1440, height: 900 }}><AppShell height={900} topBar={null}><S /></AppShell></div>],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const repo = 'harbor-labs/invoicer-api';
const projectName = 'invoicer-api';
const rule = rules[0];

export const Setup1: Story = {
  name: 'Setup 1, connect repository',
  render: () => (
    <Setup1Screen
      user={user}
      projectName={projectName}
      repos={[
        { name: repo, meta: 'Private, updated 2 hours ago' },
        { name: 'harbor-labs/invoicer-web', meta: 'Private, updated yesterday' },
        { name: 'harbor-labs/infra-k8s', meta: 'Private, updated 5 days ago' },
      ]}
      selected={repo}
      installedOn="harbor-labs"
      pingAt="14:01:37"
      nextHref="#"
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

export const SetupReady: Story = {
  name: 'Setup, ready',
  render: () => (
    <SetupReadyScreen
      user={user}
      projectName={projectName}
      repo={repo}
      label={{ name: 'user-story', color: '#7C8FD8' }}
      command="/code-build"
      lastWebhook="ping, 14:01:37"
      summary={[
        { term: 'Repository', value: <span className="mono">{repo}</span> },
        { term: 'Agent', value: 'Claude, opus, 30 min limit, 2 at a time' },
        { term: 'Skills', value: <span className="mono">code-build, code-review</span> },
        { term: 'Rules', value: <><CommandChip>/code-build</CommandChip> on issues labelled user-story; <CommandChip>/code-review</CommandChip> on pull requests</> },
      ]}
    />
  ),
};
