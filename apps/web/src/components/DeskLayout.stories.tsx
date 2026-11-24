import type { Meta, StoryObj } from '@storybook/react-vite';
import { connections, orgSwitchFixtures } from '@/mocks';
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
    projectName: 'invoicer-api',
    repo: { org: 'harbor-labs', name: 'invoicer-api', branch: 'main', connected: true },
    links: { skills: '#skills', rules: '#rules', agent: '#agent' },
    children: <div style={{ padding: 24 }}>Page content</div>,
  },
  render: (args) => (
    <AppShell
      height={520}
      topBar={
        <TopBar
          variant="project"
          crumbs={[{ label: 'Project settings', href: '#desk' }, { label: 'Skills' }]}
          user={{ login: 'kim-hale', initials: 'KH' }}
          project={{ name: 'invoicer-api', repoUrl: '#' }}
          org={{ ...orgSwitchFixtures.severalOrgsSettings, orgHref: (o) => `#${o.slug}`, createHref: '#new-org' }}
          active="desk"
          needsYou={1}
          links={{ desk: '#desk' }}
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

const accessLinks = { skills: '#skills', rules: '#rules', agent: '#agent', members: '#members', audit: '#audit' };

/** Owner, org admin or project admin: the "Access" group after "Agent & settings". */
export const WithAccess: Story = {
  ...Skills,
  args: { ...Skills.args, active: 'agent', links: accessLinks },
};

export const MembersActive: Story = {
  ...Skills,
  args: { ...Skills.args, active: 'members', links: accessLinks },
};

export const AuditActive: Story = {
  ...Skills,
  args: { ...Skills.args, active: 'audit', links: accessLinks },
};
