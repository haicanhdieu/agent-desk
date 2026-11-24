import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button, IconButton, StatusBadge } from '@/ds';
import { orgSwitchFixtures } from '@/mocks';
import { NO_PAGE_CRUMBS } from './pageTitle';
import { TopBar } from './TopBar';

const user = { login: 'kim-hale', initials: 'KH' };
const project = { name: 'invoicer-api', repoUrl: 'https://github.com/harbor-labs/invoicer-api' };

const meta = { title: 'Components/TopBar', component: TopBar, parameters: { layout: 'fullscreen' } } satisfies Meta<
  typeof TopBar
>;
export default meta;
type Story = StoryObj<typeof meta>;

const orgBase = {
  orgHref: (o: { slug: string }) => `/o/${o.slug}`,
  createHref: '/platform/orgs/new',
  projectsHref: '#projects',
};
const orgWithSettings = { ...orgBase, ...orgSwitchFixtures.oneOrg, settingsHref: '#settings' };
const orgNoSettings = { ...orgBase, ...orgSwitchFixtures.oneOrg };
const links = { projects: '#projects', runs: '#runs', desk: '#desk' };

export const OrgLevelOwner: Story = {
  args: {
    variant: 'global',
    user,
    crumbs: [{ label: 'Projects' }],
    org: orgWithSettings,
    tabs: 'org',
    active: 'projects',
    links,
  },
};
export const OrgLevelMember: Story = {
  args: {
    variant: 'global',
    user,
    crumbs: [{ label: 'Projects' }],
    org: orgNoSettings,
    tabs: 'org',
    active: 'projects',
    links,
  },
};
export const OrgLevelSettingsActive: Story = {
  args: {
    variant: 'global',
    user,
    crumbs: [{ label: 'Org settings', href: '#settings' }, { label: 'General' }],
    org: orgWithSettings,
    tabs: 'org',
    active: 'settings',
    links,
  },
};
export const PersonalNoTabActive: Story = {
  args: { variant: 'global', user, crumbs: [{ label: 'Projects' }], org: orgWithSettings, tabs: 'org', links },
};
export const CreateOrgNoTabs: Story = {
  args: {
    variant: 'global',
    user,
    crumbs: [{ label: 'Create organization' }],
    org: { ...orgBase, ...orgSwitchFixtures.platformAdmin },
    tabs: 'none',
  },
};
export const NoOrg: Story = {
  args: {
    variant: 'global',
    user,
    crumbs: NO_PAGE_CRUMBS,
    org: { ...orgBase, current: null, orgs: [], platformAdmin: false },
  },
};
export const ProjectLevel: Story = {
  args: {
    variant: 'project',
    user,
    crumbs: [{ label: 'Runs' }],
    org: orgWithSettings,
    project,
    active: 'runs',
    needsYou: 1,
    links,
  },
};
export const ProjectLevelDesk: Story = {
  args: {
    variant: 'project',
    user,
    crumbs: [{ label: 'Project settings', href: '#desk' }, { label: 'Skills' }],
    org: orgWithSettings,
    project,
    active: 'desk',
    links,
  },
};
export const LongOrgName: Story = {
  args: {
    variant: 'global',
    user,
    crumbs: [{ label: 'Projects' }],
    org: { ...orgBase, ...orgSwitchFixtures.longName, settingsHref: '#settings' },
    tabs: 'org',
    active: 'projects',
    links,
  },
};
export const RunLevelCrumbs: Story = {
  args: {
    variant: 'run',
    user,
    org: orgWithSettings,
    project,
    crumbs: [{ label: 'Runs', href: '#runs' }, { label: 'Run 61' }],
    children: (
      <>
        <StatusBadge status="running" />
        <span>
          <code>/code-build</code> on Issue #139
        </span>
        <span className="num muted">7:40</span>
      </>
    ),
    actions: (
      <>
        <Button disabled icon="check">
          Finish
        </Button>
        <Button variant="danger" icon="x">
          Cancel run
        </Button>
        <span style={{ width: 1, height: 22, background: 'var(--line2)' }} />
        <IconButton icon="panel" aria-label="Toggle side panel" />
        <IconButton icon="fullscreen" aria-label="Full screen" />
      </>
    ),
  },
};
export const LoadingCrumb: Story = {
  args: {
    variant: 'global',
    user,
    org: orgWithSettings,
    crumbs: [{ label: '', loading: true, what: 'organization' }],
  },
};
export const LongNames: Story = {
  args: {
    variant: 'project',
    user,
    org: { ...orgWithSettings, ...orgSwitchFixtures.longName },
    project: { name: 'p'.repeat(60), repoUrl: project.repoUrl },
    crumbs: [{ label: 'Project settings', href: '#desk' }, { label: 'Skills' }],
    active: 'runs',
    links,
  },
};
export const ForbiddenPage: Story = {
  args: { variant: 'global', user, org: orgWithSettings, crumbs: NO_PAGE_CRUMBS, state: 'forbidden' },
};

const platformOrg = {
  ...orgBase,
  ...orgSwitchFixtures.platformAdmin,
  scope: 'platform' as const,
  platformHref: '#platform',
};
const platformTabs = { links: { orgs: '#orgs', admins: '#admins', audit: '#audit' } };
export const PlatformLevel: Story = {
  args: {
    variant: 'platform',
    user,
    org: platformOrg,
    crumbs: [{ label: 'Organizations', href: '#orgs' }, { label: 'Harbor Labs' }],
    platformTabs: { ...platformTabs, active: 'orgs' },
  },
};
export const PlatformOrgLoading: Story = {
  args: {
    variant: 'platform',
    user,
    org: platformOrg,
    crumbs: [
      { label: 'Organizations', href: '#orgs' },
      { label: '', loading: true, what: 'organization' },
    ],
    platformTabs: { ...platformTabs, active: 'orgs' },
  },
};
