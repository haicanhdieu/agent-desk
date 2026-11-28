import type { Meta, StoryObj } from '@storybook/react-vite';
import { orgSwitchFixtures } from '@/mocks';
import { NO_PAGE_CRUMBS } from './pageTitle';
import { TopBar } from './TopBar';

const user = { login: 'kim-hale', initials: 'KH' };
const projectName = 'invoicer-api';

const meta = { title: 'Components/TopBar', component: TopBar, parameters: { layout: 'fullscreen' } } satisfies Meta<
  typeof TopBar
>;
export default meta;
type Story = StoryObj<typeof meta>;

const orgBase = {
  orgHref: (o: { slug: string }) => `/o/${o.slug}`,
  createHref: '/platform/orgs/new',
};
const org = { ...orgBase, ...orgSwitchFixtures.severalOrgs };

export const OrgLevel: Story = {
  args: { user, crumbs: [{ label: 'Projects' }], org },
};
export const CreateOrg: Story = {
  args: {
    user,
    crumbs: [{ label: 'Create organization' }],
    org: { ...orgBase, ...orgSwitchFixtures.platformAdmin },
  },
};
export const NoOrg: Story = {
  args: {
    user,
    crumbs: NO_PAGE_CRUMBS,
    org: { ...orgBase, current: null, orgs: [], platformAdmin: false },
  },
};
export const ProjectLevel: Story = {
  args: { user, crumbs: [{ label: 'Runs' }], org, projectName },
};
export const ProjectSettings: Story = {
  args: {
    user,
    crumbs: [{ label: 'Agent & settings' }],
    org,
    projectName,
  },
};
export const LongOrgName: Story = {
  args: { user, crumbs: [{ label: 'Projects' }], org: { ...orgBase, ...orgSwitchFixtures.longName } },
};
export const RunLevelCrumbs: Story = {
  args: {
    user,
    org,
    projectName,
    crumbs: [{ label: 'Runs', href: '#runs' }, { label: 'Run 61' }],
  },
};
export const LoadingCrumb: Story = {
  args: { user, org, crumbs: [{ label: '', loading: true, what: 'organization' }] },
};
export const LongNames: Story = {
  args: {
    user,
    org: { ...orgBase, ...orgSwitchFixtures.longName },
    projectName: 'p'.repeat(60),
    crumbs: [{ label: 'Skills' }],
  },
};

const platformOrg = {
  ...orgBase,
  ...orgSwitchFixtures.platformAdmin,
  scope: 'platform' as const,
  platformHref: '#platform',
};
export const PlatformLevel: Story = {
  args: {
    user,
    org: platformOrg,
    crumbs: [{ label: 'Organizations', href: '#orgs' }, { label: 'Harbor Labs' }],
  },
};
export const PlatformOrgLoading: Story = {
  args: {
    user,
    org: platformOrg,
    crumbs: [
      { label: 'Organizations', href: '#orgs' },
      { label: '', loading: true, what: 'organization' },
    ],
  },
};

export const WithOpenMenu: Story = {
  args: { user, crumbs: NO_PAGE_CRUMBS, org, onOpenMenu: () => {}, menuOpen: false },
};
export const WithOpenMenuExpanded: Story = { args: { ...WithOpenMenu.args, menuOpen: true } };
