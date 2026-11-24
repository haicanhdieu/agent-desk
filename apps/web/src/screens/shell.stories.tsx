import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { AppShell, type PageCrumb, type PlatformOrgGroup } from '@/components';
import {
  activeOrgOverview,
  orgSwitchFixtures,
  platformAdminRows,
  platformAuditActions,
  platformAuditRows,
  platformMemberRows,
  platformOrgRows,
  runDetails,
  terminalByRun,
  type PlatformMemberRowView,
} from '@/mocks';
import { CreateOrg } from './CreateOrg';
import { PlatformAdmins } from './PlatformAdmins';
import { PlatformAudit } from './PlatformAudit';
import { PlatformOrgDetail } from './PlatformOrgDetail';
import { PlatformOrgMembers } from './PlatformOrgMembers';
import { PlatformOrgs } from './PlatformOrgs';
import type { ListView } from './PlatformOrgProjects';
import { PlatformFrame, platformScope } from './platformFrame';
import { RunDetail } from './RunDetail';
import { viewport } from './viewports';

// The shared app shell on the run page: org / project / Runs / Run N with the bell and no tabs.
const meta = {
  title: 'Screens/Shell',
  component: RunDetail,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RunDetail>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Board RunIdleShell: the run bar over the idle run 62. */
export const RunIdleShell: Story = {
  decorators: [
    (S) => (
      <div style={{ width: 1440, height: 900 }}>
        <S />
      </div>
    ),
  ],
  globals: viewport(1440, 900),
  args: {
    data: runDetails.RunIdle,
    lines: terminalByRun[62],
    org: { ...orgSwitchFixtures.severalOrgsSettings, orgHref: (o) => `#${o.slug}`, createHref: '#new-org' },
    run: { runsHref: '#runs', label: 'Run 62' },
  },
};

// The platform bar and the side menu around the five platform screens: scope crumb "Platform", page crumbs, Platform
// sections tabs, the bell. Only inside one org does a side menu show.
const noop = () => undefined;
type PlatformStory = StoryObj;
const platformDecorators: PlatformStory['decorators'] = [
  (S) => (
    <AppShell height={900} topBar={null}>
      <S />
    </AppShell>
  ),
];
const platformStory = (render: PlatformStory['render'], play?: PlatformStory['play']): PlatformStory => ({
  decorators: platformDecorators,
  globals: viewport(1440, 900),
  render,
  play,
});
const pagination = {
  page: 1,
  pageSize: 20 as const,
  total: 3,
  onPageChange: noop,
  onPageSizeChange: noop,
};
const orgLinks = {
  overview: '/platform/orgs/org_harbor',
  projects: '/platform/orgs/org_harbor/projects',
  members: '/platform/orgs/org_harbor/members',
  invitations: '/platform/orgs/org_harbor/invitations',
};
const orgCrumbs = (...rest: PageCrumb[]): PageCrumb[] => [
  { label: 'Organizations', href: '/platform/orgs' },
  { label: 'Harbor Labs', href: orgLinks.overview },
  ...rest,
];
const listError = {
  kind: 'error' as const,
  title: 'Internal server error',
  requestId: 'req_01JDP8C5N6WY',
  onRetry: noop,
};
const orgHeader = {
  name: 'Harbor Labs',
  slug: 'harbor-labs',
  status: 'active' as const,
  auditHref: '/platform/audit?org=harbor-labs',
  onSuspend: noop,
  onReactivate: noop,
  onEdit: noop,
};
const orgsScreen = () => (
  <PlatformFrame active="orgs">
    <PlatformOrgs
      view={{
        kind: 'ready',
        rows: platformOrgRows,
        pagination: { ...pagination, total: platformOrgRows.length },
      }}
      filters={{ q: '', status: 'all', active: false }}
      onSearch={noop}
      onStatus={noop}
      onClearFilters={noop}
      createHref="/platform/orgs/new"
    />
  </PlatformFrame>
);
const membersPage = (view: ListView<PlatformMemberRowView>, group: PlatformOrgGroup, crumbs: PageCrumb[]) => (
  <PlatformFrame active="members" org={group} crumbs={crumbs}>
    <PlatformOrgDetail view={{ kind: 'ready', header: orgHeader, overview: activeOrgOverview }}>
      <PlatformOrgMembers view={view} onAdd={noop} onRemove={noop} />
    </PlatformOrgDetail>
  </PlatformFrame>
);
const readyGroup: PlatformOrgGroup = { state: 'ready', name: 'Harbor Labs', links: orgLinks };

/** Board PlatformOrgsShell: Platform / Organizations with the Platform sections tabs and no side menu. */
export const PlatformOrgsShell: PlatformStory = platformStory(orgsScreen);

/** Board PlatformAdminsShell. */
export const PlatformAdminsShell: PlatformStory = platformStory(() => (
  <PlatformFrame active="admins">
    <PlatformAdmins
      view={{
        kind: 'ready',
        rows: platformAdminRows,
        pagination: { ...pagination, total: platformAdminRows.length },
      }}
      onAdd={noop}
      onRevoke={noop}
    />
  </PlatformFrame>
));

/** Board PlatformAuditShell. */
export const PlatformAuditShell: PlatformStory = platformStory(() => (
  <PlatformFrame active="audit">
    <PlatformAudit
      view={{ kind: 'ready', rows: platformAuditRows, pagination: { ...pagination, total: platformAuditRows.length } }}
      action="all"
      actions={platformAuditActions}
      onAction={noop}
      filtered={false}
      onClearFilters={noop}
    />
  </PlatformFrame>
));

/** Board PlatformOrgsShellScopeMenu: the scope switch open for a platform admin with no membership. */
export const PlatformOrgsShellScopeMenu: PlatformStory = platformStory(
  () => (
    <PlatformFrame active="orgs" scopeOrg={platformScope(orgSwitchFixtures.platformAdminNoOrg)}>
      <PlatformOrgs
        view={{ kind: 'ready', rows: platformOrgRows, pagination: { ...pagination, total: platformOrgRows.length } }}
        filters={{ q: '', status: 'all', active: false }}
        onSearch={noop}
        onStatus={noop}
        onClearFilters={noop}
        createHref="/platform/orgs/new"
      />
    </PlatformFrame>
  ),
  async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch scope/ }));
  },
);

/** Board PlatformOrgMembersShellLoading: a fixed-width crumb skeleton and a side menu placeholder of the ready height. */
export const PlatformOrgMembersShellLoading: PlatformStory = platformStory(() =>
  membersPage(
    { kind: 'loading' },
    { state: 'loading' },
    orgCrumbs({ label: 'Members' }).map((c, i) => (i === 1 ? { label: '', loading: true, what: 'organization' } : c)),
  ),
);

/** Board PlatformOrgMembersShellError: the org read failed; the crumb and the side menu group read "Organization". */
export const PlatformOrgMembersShellError: PlatformStory = platformStory(() =>
  membersPage(listError, { ...readyGroup, state: 'error', name: 'Organization' }, [
    { label: 'Organizations', href: '/platform/orgs' },
    { label: 'Organization', href: orgLinks.overview },
    { label: 'Members' },
  ]),
);

/** Board PlatformOrgMembersShellNonMember: a platform admin who is not a member of the org sees the same page. */
export const PlatformOrgMembersShellNonMember: PlatformStory = platformStory(() =>
  membersPage(
    {
      kind: 'ready',
      rows: platformMemberRows,
      pagination: { ...pagination, total: platformMemberRows.length },
    },
    readyGroup,
    orgCrumbs({ label: 'Members' }),
  ),
);

/** Board PlatformOrgOverviewShellNotFound: Organizations / Not found, no side menu. */
export const PlatformOrgOverviewShellNotFound: PlatformStory = platformStory(() => (
  <PlatformFrame
    active="overview"
    crumbs={[{ label: 'Organizations', href: '/platform/orgs' }, { label: 'Not found' }]}
  >
    <PlatformOrgDetail view={{ kind: 'notFound', backHref: '/platform/orgs' }} />
  </PlatformFrame>
));

/** Board CreateOrgPlatformShell: Organizations / Create organization inside the platform shell, no side menu. */
export const CreateOrgPlatformShell: PlatformStory = platformStory(() => (
  <PlatformFrame
    active="orgs"
    sideMenu={false}
    crumbs={[{ label: 'Organizations', href: '/platform/orgs' }, { label: 'Create organization' }]}
  >
    <CreateOrg
      state={{
        kind: 'form',
        values: { name: '', slug: '', email: '' },
        errors: {},
        saving: false,
      }}
      onChange={noop}
      onSubmit={noop}
      onRetry={noop}
      onCopy={noop}
      onDone={noop}
    />
  </PlatformFrame>
));
