import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { orgSwitchFixtures } from '@/mocks';
import { OrgSwitch } from './OrgSwitch';

const links = {
  orgHref: (o: { slug: string }) => `/o/${o.slug}`,
  createHref: '/platform/orgs/new',
  projectsHref: '/o/acme/projects',
  settingsHref: '/o/acme/settings',
};

const meta = {
  title: 'Components/OrgSwitch',
  component: OrgSwitch,
  args: links,
  decorators: [
    (Story) => (
      <div style={{ minHeight: 220, padding: 16 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrgSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

const openOnLoad: Story['play'] = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch scope/ }));
};

export const OneOrg: Story = { args: orgSwitchFixtures.oneOrg, play: openOnLoad };
export const OneOrgNoSettings: Story = {
  args: { ...orgSwitchFixtures.oneOrg, settingsHref: undefined },
  play: openOnLoad,
};
export const SeveralOrgs: Story = { args: orgSwitchFixtures.severalOrgs };
export const Open: Story = { args: orgSwitchFixtures.severalOrgs, play: openOnLoad };
export const PlatformAdmin: Story = { args: orgSwitchFixtures.platformAdmin, play: openOnLoad };
export const PlatformAdminNoOrg: Story = { args: orgSwitchFixtures.platformAdminNoOrg, play: openOnLoad };
export const WithPlatformItem: Story = {
  args: { ...orgSwitchFixtures.platformAdmin, platformHref: '/platform/orgs' },
  play: openOnLoad,
};
export const NoOrgPlatformItem: Story = {
  args: { ...orgSwitchFixtures.platformAdminNoOrg, platformHref: '/platform/orgs' },
  play: openOnLoad,
};
const scopeOnly = {
  orgHref: links.orgHref,
  createHref: links.createHref,
  projectsHref: undefined,
  settingsHref: undefined,
};
export const Loading: Story = {
  args: {
    ...scopeOnly,
    ...orgSwitchFixtures.platformAdmin,
    platformHref: '/platform/orgs',
    list: { status: 'loading' },
  },
  play: openOnLoad,
};
export const ErrorWithRetry: Story = {
  args: {
    ...scopeOnly,
    ...orgSwitchFixtures.platformAdmin,
    platformHref: '/platform/orgs',
    list: { status: 'error', onRetry: () => undefined },
  },
  play: openOnLoad,
};
export const PlainText: Story = { args: { ...scopeOnly, ...orgSwitchFixtures.oneOrg } };
export const ScopeOnlyOpen: Story = {
  args: { ...scopeOnly, ...orgSwitchFixtures.platformAdmin, platformHref: '/platform/orgs' },
  play: openOnLoad,
};
export const NoOrg: Story = { args: { current: null, orgs: [], platformAdmin: false } };
export const LongName: Story = { args: orgSwitchFixtures.longName, play: openOnLoad };
export const WithSuspendedOrg: Story = {
  args: {
    ...orgSwitchFixtures.severalOrgs,
    orgs: orgSwitchFixtures.severalOrgs.orgs.map((o, i) => (i === 1 ? { ...o, suspended: true } : o)),
  },
  play: openOnLoad,
};

const platformLinks = { platformHref: '/platform/orgs' };
export const PlatformScope: Story = {
  args: { ...orgSwitchFixtures.platformAdmin, ...platformLinks, scope: 'platform' },
  play: openOnLoad,
};
export const PlatformScopeNoMembership: Story = {
  args: { ...orgSwitchFixtures.platformAdminNoOrg, ...platformLinks, scope: 'platform' },
  play: openOnLoad,
};
export const DualRole: Story = {
  args: { ...orgSwitchFixtures.platformAdminSettings, ...platformLinks },
  play: openOnLoad,
};
export const MemberOnly: Story = { args: orgSwitchFixtures.oneOrgSettings, play: openOnLoad };
export const DualRoleManage: Story = {
  args: { ...orgSwitchFixtures.platformAdminSettings, ...platformLinks, manageHref: '/platform/orgs/acme' },
  play: openOnLoad,
};
