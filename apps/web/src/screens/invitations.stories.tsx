import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, type OrgSwitchProps } from '@/components';
import { orgSwitchFixtures } from '@/mocks';
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
