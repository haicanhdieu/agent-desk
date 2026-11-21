import type { Meta, StoryObj } from '@storybook/react-vite';
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
import {
  MyInvitations as MyInvitationsScreen,
  type MyInvitationsProps,
  type MyInvitationsState,
} from './MyInvitations';
import {
  InvitationAccept as InvitationAcceptScreen,
  type InvitationAcceptProps,
  type InvitationAcceptState,
} from './InvitationAccept';
import {
  OrgInvitations as OrgInvitationsScreen,
  type InvitationFilter,
  type OrgInvitationsProps,
} from './OrgInvitations';
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
    (S) => (
      <AppShell height={900} topBar={null}>
        <S />
      </AppShell>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const adminOrg: OrgSwitchProps = {
  ...orgSwitchFixtures.platformAdminNoOrg,
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/orgs/new',
};

const screen = (state: MyInvitationsState, user: Actor = dana, org?: MyInvitationsProps['org']) => (
  <MyInvitationsScreen user={user} org={org} state={state} onAccept={noop} onDecline={noop} onSignOut={noop} />
);

export const MyInvitations: Story = {
  name: 'Welcome, pending invitations',
  render: () => screen({ kind: 'list', cards, pending: null }),
};
export const MyInvitationsAccepting: Story = {
  name: 'Welcome, accepting one invitation',
  render: () => screen({ kind: 'list', cards, pending: { id: cards[0].id, action: 'accept' } }),
};
export const MyInvitationsEmpty: Story = {
  name: 'Welcome, no org, no invitations',
  render: () =>
    screen({ kind: 'empty', email: 'dana.ortiz@example.com', platformAdmin: false, createHref: '/orgs/new' }),
};
export const MyInvitationsEmptyPlatformAdmin: Story = {
  name: 'Welcome, platform admin, no org',
  render: () =>
    screen(
      { kind: 'empty', email: 'ops@example.com', platformAdmin: true, createHref: '/orgs/new' },
      opsAdmin,
      adminOrg,
    ),
};
export const MyInvitationsError: Story = {
  name: 'Welcome, failed to load',
  render: () => screen({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }),
};
export const MyInvitationsLoading: Story = {
  name: 'Welcome, loading',
  render: () => screen({ kind: 'loading' }),
};

const harbor: InvitationDetailsView = {
  ...cards[0],
  orgSlug: 'harbor-labs',
  status: 'pending',
};
const jo: Actor = { login: 'jo-marsh', initials: 'JM' };
const harborOrg: OrgSwitchProps = {
  current: { id: 'o1', slug: 'harbor-labs', name: 'Harbor Labs' },
  orgs: [{ id: 'o1', slug: 'harbor-labs', name: 'Harbor Labs' }],
  platformAdmin: false,
  orgHref: (o) => `/o/${o.slug}/projects`,
  createHref: '/orgs/new',
};

const accept = (state: InvitationAcceptState, user: Actor = dana, org?: InvitationAcceptProps['org']) => (
  <InvitationAcceptScreen
    user={user}
    org={org}
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
  render: () => accept(pendingState()),
};
export const InvitationAcceptAccepted: Story = {
  name: 'Invitation, already joined',
  render: () =>
    accept({ kind: 'accepted', orgName: 'Harbor Labs', orgHref: '/o/harbor-labs/projects' }, dana, harborOrg),
};
export const InvitationAcceptAccepting: Story = {
  name: 'Invitation, accepting',
  render: () => accept(pendingState('accept')),
};
export const InvitationAcceptDeclineConfirm: Story = {
  name: 'Invitation, decline confirm',
  render: () => accept(pendingState(null, true)),
};
export const InvitationAcceptDeclined: Story = {
  name: 'Invitation, declined',
  render: () => accept({ kind: 'declined', invitationsHref: '/invitations' }),
};
export const InvitationAcceptDeclining: Story = {
  name: 'Invitation, declining',
  render: () => accept(pendingState('decline', true)),
};
export const InvitationAcceptError: Story = {
  name: 'Invitation, failed to load',
  render: () => accept({ kind: 'error', requestId: 'req_01JD7Q3M8V2K', onRetry: noop }),
};
export const InvitationAcceptExpired: Story = {
  name: 'Invitation, expired',
  render: () => accept({ kind: 'expired', orgName: 'Harbor Labs', inviter: 'Kim Hale' }),
};
export const InvitationAcceptExpiredInviterDeleted: Story = {
  name: 'Invitation, expired, inviter deleted',
  render: () => accept({ kind: 'expired', orgName: 'Harbor Labs', inviter: null }),
};
export const InvitationAcceptLoading: Story = {
  name: 'Invitation, loading',
  render: () => accept({ kind: 'loading' }),
};
export const InvitationAcceptNotAvailable: Story = {
  name: 'Invitation, not available',
  render: () => accept({ kind: 'notAvailable', email: 'jo.marsh@example.org' }, jo),
};
export const InvitationAcceptRevoked: Story = {
  name: 'Invitation, revoked',
  render: () => accept({ kind: 'revoked' }),
};

const kim: Actor = { login: 'kim-hale', initials: 'KH' };
const sam: Actor = { login: 'sam-reyes', initials: 'SR' };
const byStatus = (status: InvitationFilter) => orgInvitationRows.filter((r) => status === 'all' || r.status === status);
const pendingRows = byStatus('pending');
const expiredRows = byStatus('expired');

const list = (
  filter: InvitationFilter,
  state: OrgInvitationsProps['state'],
  extra: Partial<OrgInvitationsProps> = {},
  user: Actor = kim,
) => (
  <OrgInvitationsScreen
    user={user}
    org={harborOrg}
    filter={filter}
    onFilterChange={noop}
    state={state}
    onInvite={noop}
    onCopy={noop}
    onResend={noop}
    onRevoke={noop}
    {...extra}
  />
);
const ready = (rows: typeof orgInvitationRows, pagination?: PaginationProps): OrgInvitationsProps['state'] => ({
  kind: 'ready',
  rows,
  busyRowId: null,
  ...(pagination && { pagination }),
});

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
  render: () => list('pending', { kind: 'forbidden' }, {}, sam),
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
