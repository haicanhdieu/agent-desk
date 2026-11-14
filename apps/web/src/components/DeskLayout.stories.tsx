import type { Meta, StoryObj } from '@storybook/react-vite';
import { connections } from '@/mocks';
import { AppShell } from './AppShell';
import { DeskLayout } from './DeskLayout';
import { TopBar } from './TopBar';

const meta = {
  title: 'Components/DeskLayout',
  component: DeskLayout,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DeskLayout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Skills: Story = {
  args: {
    active: 'skills',
    repo: { org: 'harbor-labs', name: 'invoicer-api', branch: 'main', connected: true },
    children: <div style={{ padding: 24 }}>Page content</div>,
  },
  render: (args) => (
    <AppShell
      height={520}
      topBar={
        <TopBar
          variant="project"
          user={{ login: 'kim-hale', initials: 'KH' }}
          project={{ org: 'harbor-labs', name: 'invoicer-api', repoUrl: '#' }}
          active="desk"
          needsYou={1}
        />
      }
    >
      <DeskLayout {...args} />
    </AppShell>
  ),
};

export const Polling: Story = {
  ...Skills,
  args: {
    ...Skills.args,
    active: 'agent',
    repo: { org: 'harbor-labs', name: 'invoicer-api', branch: 'main', connected: true, status: connections.pollingOk },
  },
};

export const PollingFailed: Story = {
  ...Skills,
  args: {
    ...Skills.args,
    active: 'agent',
    repo: {
      org: 'harbor-labs',
      name: 'invoicer-api',
      branch: 'main',
      connected: false,
      status: connections.pollingRevoked,
    },
  },
};
