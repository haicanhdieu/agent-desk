import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, type OrgSwitchProps } from '@/components';
import { orgSwitchFixtures } from '@/mocks';
import type { Actor, InvitationCardView } from '@/mocks/types';
import {
  MyInvitations as MyInvitationsScreen,
  type MyInvitationsProps,
  type MyInvitationsState,
} from './MyInvitations';
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
