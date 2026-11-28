import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { userEvent, waitFor, within } from 'storybook/test';
import {
  AppShell,
  InviteDialog,
  type InviteDialogProps,
  type InviteDialogStep,
  type InviteDialogValues,
  type OrgSwitchProps,
  type PaginationProps,
} from '@/components';
import {
  invitationLink,
  inviteProjectOptions,
  inviteRoleOptions,
  orgInvitationRows,
  orgSwitchFixtures,
  pagedInvitationRows,
} from '@/mocks';
import type { Actor, InvitationCardView, InvitationDetailsView } from '@/mocks/types';
import { MyInvitations as MyInvitationsScreen, type MyInvitationsState } from './MyInvitations';
import { InvitationAccept as InvitationAcceptScreen, type InvitationAcceptState } from './InvitationAccept';
import {
  OrgInvitations as OrgInvitationsScreen,
  type InvitationFilter,
  type OrgInvitationsProps,
} from './OrgInvitations';
import { CreateOrg as CreateOrgScreen, type CreateOrgState, type CreateOrgValues } from './CreateOrg';
import { PlatformFrame } from './platformShellFrame';
import { OrgSettingsFrame, OrgShellFrame } from './orgShellFrame';
import { ShellFrame } from './shellFrame';
import { viewport } from './viewports';

const noop = () => undefined;

const dana: Actor = { login: 'dana-ortiz', initials: 'DO' };
const opsAdmin: Actor = { login: 'ops-admin', initials: 'OA' };

const cards: InvitationCardView[] = [
  {
    id: 'c2000000-0000-4000-8000-000000000001',
    orgName: 'Harbor Labs',
    roleName: 'Member',
    access: 'invoicer-api, invoicer-web',
    inviter: 'Kim Hale',
    expires: { text: '23 Nov, 14:05', title: '23 Nov 2026, 14:05', dateTime: '2026-11-23T14:05:00Z' },
  },
  {
    id: 'c2000000-0000-4000-8000-000000000002',
    orgName: 'Northwind Analytics',
    roleName: 'Viewer',
    access: 'Whole organization',
    inviter: null,
    expires: { text: '22 Nov, 09:30', title: '22 Nov 2026, 09:30', dateTime: '2026-11-22T09:30:00Z' },
  },
];

const meta = {
  title: 'Screens/Invitations',
  parameters: { layout: 'fullscreen' },
  globals: viewport(1440, 900),
  decorators: [
    // A story with `parameters.shell` brings its own ShellFrame; the others sit in the old bare frame.
    (S, { parameters }) =>
      parameters.shell ? (
        <S />
      ) : (
        <AppShell height={900} topBar={null}>
          <S />
        </AppShell>
      ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const noOrg: OrgSwitchProps = {
  current: null,
  orgs: [],
  platformAdmin: false,
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
};

const adminOrg: OrgSwitchProps = {
  ...orgSwitchFixtures.platformAdminNoOrg,
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
};

/** The org bar with no tab active: a person of one org. */
const harborBar: OrgSwitchProps = {
  current: { id: 'o1', slug: 'harbor-labs', name: 'Harbor Labs' },
  orgs: [{ id: 'o1', slug: 'harbor-labs', name: 'Harbor Labs' }],
  platformAdmin: false,
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/platform/orgs/new',
};

const legacyScreen = (state: MyInvitationsState, user: Actor = dana, org: OrgSwitchProps = harborBar) => (
  <OrgShellFrame page={null} user={user} org={org} crumbs={[{ label: 'My invitations' }]}>
    <MyInvitationsScreen state={state} onAccept={noop} onDecline={noop} onSignOut={noop} />
  </OrgShellFrame>
);

export const MyInvitations: Story = {
  name: 'Welcome, pending invitations',
  render: () => legacyScreen({ kind: 'list', cards, pending: null }),
};
export const MyInvitationsAccepting: Story = {
  name: 'Welcome, accepting one invitation',
  render: () => legacyScreen({ kind: 'list', cards, pending: { id: cards[0].id, action: 'accept' } }),
};
export const MyInvitationsEmpty: Story = {
  name: 'Welcome, no org, no invitations',
  render: () =>
    legacyScreen(
      {
        kind: 'empty',
        member: false,
        email: 'dana.ortiz@example.com',
        platformAdmin: false,
        createHref: '/platform/orgs/new',
      },
      dana,
      noOrg,
    ),
};
export const MyInvitationsEmptyPlatformAdmin: Story = {
  name: 'Welcome, platform admin, no org',
  render: () =>
    legacyScreen(
      { kind: 'empty', member: false, email: 'ops@example.com', platformAdmin: true, createHref: '/platform/orgs/new' },
      opsAdmin,
      adminOrg,
    ),
};
export const MyInvitationsEmptyPlatformAdminMenu: Story = {
  name: 'Welcome, platform admin, no org, menu open with Platform admin',
  render: () =>
    legacyScreen(
      { kind: 'empty', member: false, email: 'ops@example.com', platformAdmin: true, createHref: '/platform/orgs/new' },
      opsAdmin,
      {
        ...adminOrg,
        platformHref: '/platform/orgs',
      },
    ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch scope/ }));
  },
};
export const MyInvitationsError: Story = {
  name: 'Welcome, failed to load',
  render: () => legacyScreen({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }),
};
export const MyInvitationsLoading: Story = {
  name: 'Welcome, loading',
  render: () => legacyScreen({ kind: 'loading' }),
};

const harbor: InvitationDetailsView = {
  ...cards[0],
  orgSlug: 'harbor-labs',
  status: 'pending',
};
const jo: Actor = { login: 'jo-marsh', initials: 'JM' };

const legacyAccept = (state: InvitationAcceptState, user: Actor = dana, org: OrgSwitchProps = harborBar) => (
  <OrgShellFrame page={null} user={user} org={org} crumbs={[{ label: 'Invitation' }]}>
    <InvitationAcceptScreen
      state={state}
      onAccept={noop}
      onDecline={noop}
      onConfirmDecline={noop}
      onCancelDecline={noop}
      onSignOut={noop}
    />
  </OrgShellFrame>
);
/** The bare pages, for the stories that bring their own shell. */
const screen = (state: MyInvitationsState) => (
  <MyInvitationsScreen state={state} onAccept={noop} onDecline={noop} onSignOut={noop} />
);
const accept = (state: InvitationAcceptState) => (
  <InvitationAcceptScreen
    state={state}
    onAccept={noop}
    onDecline={noop}
    onConfirmDecline={noop}
    onCancelDecline={noop}
    onSignOut={noop}
  />
);
const pendingState = (busy: 'accept' | 'decline' | null = null, confirmDecline = false): InvitationAcceptState => ({
  kind: 'pending',
  details: harbor,
  busy,
  confirmDecline,
});

export const InvitationAccept: Story = {
  name: 'Invitation, pending',
  render: () => legacyAccept(pendingState()),
};
export const InvitationAcceptAccepted: Story = {
  name: 'Invitation, already joined',
  render: () => legacyAccept({ kind: 'accepted', orgName: 'Harbor Labs', orgHref: '/o/harbor-labs/projects' }, dana),
};
export const InvitationAcceptAccepting: Story = {
  name: 'Invitation, accepting',
  render: () => legacyAccept(pendingState('accept')),
};
export const InvitationAcceptDeclineConfirm: Story = {
  name: 'Invitation, decline confirm',
  render: () => legacyAccept(pendingState(null, true)),
};
export const InvitationAcceptDeclined: Story = {
  name: 'Invitation, declined',
  render: () => legacyAccept({ kind: 'declined', invitationsHref: '/invitations' }),
};
export const InvitationAcceptDeclining: Story = {
  name: 'Invitation, declining',
  render: () => legacyAccept(pendingState('decline', true)),
};
export const InvitationAcceptError: Story = {
  name: 'Invitation, failed to load',
  render: () => legacyAccept({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }),
};
export const InvitationAcceptExpired: Story = {
  name: 'Invitation, expired',
  render: () => legacyAccept({ kind: 'expired', orgName: 'Harbor Labs', inviter: 'Kim Hale' }),
};
export const InvitationAcceptExpiredInviterDeleted: Story = {
  name: 'Invitation, expired, inviter deleted',
  render: () => legacyAccept({ kind: 'expired', orgName: 'Harbor Labs', inviter: null }),
};
export const InvitationAcceptLoading: Story = {
  name: 'Invitation, loading',
  render: () => legacyAccept({ kind: 'loading' }),
};
export const InvitationAcceptNotAvailable: Story = {
  name: 'Invitation, not available',
  render: () => legacyAccept({ kind: 'notAvailable', email: 'jo.marsh@example.org' }, jo, noOrg),
};
export const InvitationAcceptRevoked: Story = {
  name: 'Invitation, revoked',
  render: () => legacyAccept({ kind: 'revoked' }),
};

const byStatus = (status: InvitationFilter) => orgInvitationRows.filter((r) => status === 'all' || r.status === status);
const pendingRows = byStatus('pending');
const expiredRows = byStatus('expired');

const list = (
  filter: InvitationFilter,
  state: OrgInvitationsProps['state'],
  extra: Partial<OrgInvitationsProps> = {},
  frame: Pick<Parameters<typeof OrgSettingsFrame>[0], 'role' | 'sideMenu'> = { role: 'owner' },
) => (
  <OrgSettingsFrame {...frame} active="invitations">
    <OrgInvitationsScreen
      filter={filter}
      onFilterChange={noop}
      state={state}
      onInvite={noop}
      onCopy={noop}
      onResend={noop}
      onRevoke={noop}
      {...extra}
    />
  </OrgSettingsFrame>
);
const ready = (rows: typeof orgInvitationRows, pagination?: PaginationProps): OrgInvitationsProps['state'] => ({
  kind: 'ready',
  rows,
  busyRowId: null,
  ...(pagination && { pagination }),
});

/** The live screen: the Settings layout under the app bar, as an owner or admin sees it. */
export const OrgInvitationsSettings: Story = {
  name: 'Invitations, in Settings (owner or admin)',
  render: () => list('pending', ready(pendingRows)),
};
/** A project admin: Settings opens Invitations only. */
export const OrgInvitationsSettingsProjectAdmin: Story = {
  name: 'Invitations, in Settings (project admin)',
  render: () => list('pending', ready(pendingRows), {}, { role: 'projectAdmin' }),
};
export const OrgInvitations: Story = {
  name: 'Invitations, pending (default filter)',
  render: () => list('pending', ready(pendingRows)),
};
export const OrgInvitationsAll: Story = {
  name: 'Invitations, All',
  render: () => list('all', ready(orgInvitationRows)),
};
export const OrgInvitationsEmpty: Story = {
  name: 'Invitations, no pending invitations',
  render: () => list('pending', ready([])),
};
export const OrgInvitationsEmptyAll: Story = {
  name: 'Invitations, none yet',
  render: () => list('all', ready([])),
};
export const OrgInvitationsEmptyFiltered: Story = {
  name: 'Invitations, no declined invitations',
  render: () => list('declined', ready([])),
};
export const OrgInvitationsError: Story = {
  name: 'Invitations, failed to load',
  render: () => list('pending', { kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }),
};
export const OrgInvitationsFiltered: Story = {
  name: 'Invitations, Expired filter',
  render: () => list('expired', ready(expiredRows)),
};
export const OrgInvitationsForbidden: Story = {
  name: 'Invitations, no access',
  render: () => list('pending', { kind: 'forbidden' }, {}, { role: 'member', sideMenu: false }),
};
export const OrgInvitationsLoading: Story = {
  name: 'Invitations, loading',
  render: () => list('pending', { kind: 'loading' }),
};
export const OrgInvitationsPaged: Story = {
  name: 'Invitations, page 2 of 2',
  render: () =>
    list(
      'pending',
      ready(pagedInvitationRows(5), {
        page: 2,
        pageSize: 20,
        total: 25,
        onPageChange: noop,
        onPageSizeChange: noop,
      }),
    ),
};
export const OrgInvitationsRowMenu: Story = {
  name: 'Invitations, row menu on a pending invitation',
  render: () => list('pending', ready(pendingRows), { openMenuRowId: pendingRows[0].id }),
};
export const OrgInvitationsRowMenuExpired: Story = {
  name: 'Invitations, row menu on an expired invitation: Resend only',
  render: () => list('expired', ready(expiredRows), { openMenuRowId: expiredRows[0].id }),
};

const dialogArgs = {
  open: true,
  roles: inviteRoleOptions.owner,
  projects: inviteProjectOptions,
  projectsOnly: false,
  onChange: noop,
  onSubmit: noop,
  onCancel: noop,
  onCopy: noop,
  onDone: noop,
};
const emptyValues: InviteDialogValues = { email: '', roleId: '', scope: 'org', projectIds: [] };
const filledValues: InviteDialogValues = {
  email: 'new.person@example.com',
  roleId: 'member',
  scope: 'org',
  projectIds: [],
};
const formStep = (
  values: InviteDialogValues,
  extra: Partial<Extract<InviteDialogStep, { kind: 'form' }>> = {},
): InviteDialogStep => ({ kind: 'form', values, errors: {}, saving: false, ...extra });
const withDialog = (step: InviteDialogStep, extra: Partial<InviteDialogProps> = {}) =>
  list('pending', ready(pendingRows), {
    children: <InviteDialog {...dialogArgs} step={step} {...extra} />,
  });
const firstProject = inviteProjectOptions[0];
const linkRow = pendingRows[0];
const renewRow = pendingRows[1];

export const OrgInvitationsCopyFailed: Story = {
  name: 'Invitations, copy failed, link shown to copy by hand',
  render: () =>
    list('pending', ready(pendingRows), {
      copyFailed: { rowId: linkRow.id, link: invitationLink },
      notice: { tone: 'error', title: 'Could not copy. Select the link and copy it.', onDismiss: noop },
    }),
};
export const OrgInvitationsCreated: Story = {
  name: 'Invite dialog, invitation created, copy link',
  render: () =>
    withDialog({
      kind: 'created',
      email: 'ivy.chen@example.com',
      expiresOn: '23 Nov, 14:05',
      link: invitationLink,
    }),
};
export const OrgInvitationsInvite: Story = {
  name: 'Invite dialog, default',
  render: () => withDialog(formStep(emptyValues)),
};
export const OrgInvitationsInviteFieldError: Story = {
  name: 'Invite dialog, email already invited',
  render: () =>
    withDialog(formStep(filledValues, { errors: { email: 'This email already has a pending invitation.' } })),
};
export const OrgInvitationsInviteFormError: Story = {
  name: 'Invite dialog, form error',
  render: () => withDialog(formStep(filledValues, { formError: 'Could not create the invitation. Try again.' })),
};
export const OrgInvitationsInviteProjectAdmin: Story = {
  name: 'Invite dialog, project admin: projects they administer only, no Owner',
  render: () =>
    withDialog(formStep({ ...filledValues, roleId: 'viewer', scope: 'projects' }), {
      roles: inviteRoleOptions.projectAdmin,
      projects: inviteProjectOptions.slice(0, 1),
      projectsOnly: true,
    }),
};
export const OrgInvitationsInviteProjects: Story = {
  name: 'Invite dialog, some projects',
  render: () =>
    withDialog(formStep({ ...filledValues, scope: 'projects', projectIds: firstProject ? [firstProject.id] : [] })),
};
export const OrgInvitationsInviteSaving: Story = {
  name: 'Invite dialog, saving',
  render: () => withDialog(formStep(filledValues, { saving: true })),
};
export const OrgInvitationsInviteTabSwitched: Story = {
  name: 'Invite dialog, refused, org switched in another tab; input kept',
  render: () =>
    list('pending', ready(pendingRows), {
      children: <InviteDialog {...dialogArgs} step={formStep(filledValues)} />,
      notice: { tone: 'error', title: 'This organization was switched in another tab. Try again.', onDismiss: noop },
    }),
};
export const OrgInvitationsLinkCopied: Story = {
  name: 'Invitations, link copied',
  render: () => list('pending', ready(pendingRows), { notice: { tone: 'ok', title: 'Link copied', onDismiss: noop } }),
};
export const OrgInvitationsRenewed: Story = {
  name: 'Invitations, resend done, new expiry',
  render: () =>
    list('pending', ready(pendingRows), {
      notice: { tone: 'ok', title: 'Invitation renewed. It now expires on 23 Nov, 15:02.', onDismiss: noop },
    }),
};
export const OrgInvitationsResendConflict: Story = {
  name: 'Invitations, resend refused, invitation changed meanwhile, list refreshed',
  render: () =>
    list('pending', ready(pendingRows.filter((r) => r.id !== renewRow.id)), {
      notice: { tone: 'error', title: 'Invitation is no longer pending', onDismiss: noop },
    }),
};
export const OrgInvitationsResending: Story = {
  name: 'Invitations, resend in flight, row menu disabled',
  render: () => list('pending', { kind: 'ready', rows: pendingRows, busyRowId: renewRow.id }),
};
export const OrgInvitationsRevokeConfirm: Story = {
  name: 'Invitations, revoke confirmation',
  render: () =>
    list('pending', ready(pendingRows), {
      revokeConfirm: { email: pendingRows[0].email, onConfirm: noop, onCancel: noop },
    }),
};
export const OrgInvitationsRevoked: Story = {
  name: 'Invitations, revoked (All filter), toast',
  render: () =>
    list(
      'all',
      ready(
        orgInvitationRows.map((r) =>
          r.id === pendingRows[0].id
            ? { ...r, status: 'revoked' as const, expires: { kind: 'none' as const, text: '–' }, actions: [] }
            : r,
        ),
      ),
      { notice: { tone: 'ok', title: 'Invitation revoked', onDismiss: noop } },
    ),
};

const northwind: CreateOrgValues = {
  name: 'Northwind Analytics',
  slug: 'northwind',
  email: 'maria.chen@northwind.example',
};
const emptyOrgValues: CreateOrgValues = { name: '', slug: '', email: '' };
const requestId = 'req_01JD8B2W4N7P';

const createOrg = (state: CreateOrgState) => (
  <PlatformFrame
    active="orgs"
    sideMenu={false}
    crumbs={[{ label: 'Organizations', href: '/platform/orgs' }, { label: 'Create organization' }]}
  >
    <CreateOrgScreen state={state} onChange={noop} onSubmit={noop} onRetry={noop} onCopy={noop} onDone={noop} />
  </PlatformFrame>
);
const createForm = (
  values: CreateOrgValues,
  extra: Partial<Extract<CreateOrgState, { kind: 'form' }>> = {},
): CreateOrgState => ({ kind: 'form', values, errors: {}, saving: false, ...extra });
const inviteFailed = (retrying: boolean): CreateOrgState => ({
  kind: 'invitationFailed',
  values: northwind,
  errors: {},
  title: 'Internal server error',
  retrying,
});

export const CreateOrg: Story = {
  name: 'Create organization, empty form',
  render: () => createOrg(createForm(emptyOrgValues)),
};
export const CreateOrgCreated: Story = {
  name: 'Create organization, created, owner link',
  render: () =>
    createOrg({
      kind: 'created',
      orgId: 'org_northwind',
      email: northwind.email,
      expiresOn: '23 Nov, 14:05',
      link: 'https://agentdesk.example/invitations/7f3c2a9e-41d8-4b6e-9c0a-2e5b8d1f6a43',
    }),
};
export const CreateOrgError: Story = {
  name: 'Create organization, network or server error on create',
  render: () => createOrg(createForm(northwind, { formError: { title: 'Internal server error', requestId } })),
};
export const CreateOrgFieldErrors: Story = {
  name: 'Create organization, field errors',
  render: () =>
    createOrg(
      createForm(
        { name: '', slug: '-northwind-', email: 'maria.chen@' },
        {
          errors: {
            name: 'Enter a name.',
            slug: 'Use lowercase letters, numbers and dashes, with no dash at the start or end.',
            email: 'Enter a valid email address.',
          },
        },
      ),
    ),
};
export const CreateOrgForbidden: Story = {
  name: 'Create organization, not a platform admin',
  render: () => createOrg({ kind: 'forbidden' }),
};
export const CreateOrgInvitationFailed: Story = {
  name: 'Create organization, org created, owner invitation failed',
  render: () => createOrg(inviteFailed(false)),
};
export const CreateOrgRetrying: Story = {
  name: 'Create organization, retrying the owner invitation',
  render: () => createOrg(inviteFailed(true)),
};
export const CreateOrgSaving: Story = {
  name: 'Create organization, saving',
  render: () => createOrg(createForm(northwind, { saving: true })),
};
export const CreateOrgSlugAuto: Story = {
  name: 'Create organization, URL filled from the name',
  render: () => createOrg(createForm({ ...northwind, slug: 'northwind-analytics' })),
};
export const CreateOrgSlugEdited: Story = {
  name: 'Create organization, URL edited by hand',
  render: () => createOrg(createForm(northwind)),
};
export const CreateOrgSlugTaken: Story = {
  name: 'Create organization, URL taken',
  render: () => createOrg(createForm(northwind, { errors: { slug: 'This URL is taken. Try another.' } })),
};

/** A project admin's organization menu: Projects and, under Settings, only Invitations. */
export const OrgInvitationsSettingsSideMenuProjectAdmin: Story = {
  name: 'Organization invitations, menu for an admin of projects only',
  parameters: { shell: true },
  render: () => (
    <OrgShellFrame viewer="projectAdmin" page="invitations" crumbs={[{ label: 'Invitations' }]}>
      <OrgInvitationsScreen
        filter="pending"
        onFilterChange={() => undefined}
        state={{ kind: 'ready', rows: orgInvitationRows, busyRowId: null }}
        onInvite={() => undefined}
        onCopy={() => undefined}
        onResend={() => undefined}
        onRevoke={() => undefined}
      />
    </OrgShellFrame>
  ),
};

// The invitation pages in the one shell: the page draws only its own main. The menu is the active org's, with no
// current item (BR-56); a person with no org, or only a suspended one, has none.
const shellStory = (story: Story): Story => ({ ...story, parameters: { ...story.parameters, shell: true } });
const invitationsCrumbs = [{ label: 'My invitations' }];
const withMenu = (page: ReactNode, user: Actor = dana) => (
  <OrgShellFrame page={null} user={user} org={harborBar} crumbs={invitationsCrumbs}>
    {page}
  </OrgShellFrame>
);
const noMenu = (page: ReactNode, org: OrgSwitchProps = noOrg, user: Actor = dana) => (
  <ShellFrame topBar={{ user, crumbs: invitationsCrumbs, org }}>{page}</ShellFrame>
);
const memberEmpty: MyInvitationsState = {
  kind: 'empty',
  member: true,
  email: 'dana.ortiz@example.com',
  platformAdmin: false,
  createHref: '/platform/orgs/new',
};
const noOrgEmpty: MyInvitationsState = { ...memberEmpty, member: false };

export const MyInvitationsSideMenu: Story = shellStory({
  name: 'My invitations, organization menu',
  render: () => withMenu(screen({ kind: 'list', cards, pending: null })),
});
export const MyInvitationsEmptyMember: Story = shellStory({
  name: 'My invitations, member with none pending',
  render: () => withMenu(screen(memberEmpty)),
});
export const MyInvitationsEmptyNoOrg: Story = shellStory({
  name: 'My invitations with no organization',
  render: () => noMenu(screen(noOrgEmpty)),
});

/** Opened while the org list loads, then the list arrives empty: the switcher stays a button until it is closed. */
function HeldNoOrg() {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 50);
    return () => clearTimeout(t);
  }, []);
  const org: OrgSwitchProps = loaded ? noOrg : { ...noOrg, list: { status: 'loading' } };
  return noMenu(screen(noOrgEmpty), org);
}
export const MyInvitationsEmptySideSwitcherHeld: Story = shellStory({
  name: 'No organization: switcher held open',
  render: () => <HeldNoOrg />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Switch scope/ }));
    await waitFor(() => within(canvasElement).getByText('No organization'));
  },
});

export const InvitationAcceptSideMenu: Story = shellStory({
  name: 'Invitation, organization menu',
  render: () => withMenu(accept(pendingState())),
});
export const InvitationAcceptErrorSideMenu: Story = shellStory({
  name: 'Invitation load error keeps the organization menu',
  render: () => withMenu(accept({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop })),
});
export const InvitationAcceptNotAvailableNoMenu: Story = shellStory({
  name: 'Invitation not available, no active organization',
  render: () => noMenu(accept({ kind: 'notAvailable', email: 'jo.marsh@example.org' }), noOrg, jo),
});
