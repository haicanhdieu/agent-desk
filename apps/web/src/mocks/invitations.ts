import type {
  ExpiryView,
  InvitationCardView,
  InvitationDetailsView,
  InvitationStatusView,
  InviteOption,
  OrgInvitationRowView,
} from './types';

const EXPIRES = { text: '23 Nov, 14:05', title: '23 Nov 2026, 14:05', dateTime: '2026-11-23T14:05:00Z' };

export const invitationCards: InvitationCardView[] = [
  {
    id: 'c1000000-0000-4000-8000-000000000001',
    orgName: 'Acme',
    roleName: 'Member',
    access: 'Whole organization',
    inviter: 'Ada Lovelace',
    expires: EXPIRES,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000002',
    orgName: 'Beta',
    roleName: 'Admin',
    access: 'api, web',
    inviter: 'grace',
    expires: EXPIRES,
  },
  {
    id: 'c1000000-0000-4000-8000-000000000003',
    orgName: 'Gamma',
    roleName: 'Viewer',
    access: 'Whole organization',
    inviter: null,
    expires: EXPIRES,
  },
];

const base = invitationCards[0];
const detail = (status: InvitationStatusView, over: Partial<InvitationDetailsView> = {}): InvitationDetailsView => ({
  ...base,
  orgSlug: 'acme',
  status,
  ...over,
});

export const invitationDetails: Record<InvitationStatusView, InvitationDetailsView> = {
  pending: detail('pending'),
  accepted: detail('accepted'),
  declined: detail('declined'),
  revoked: detail('revoked'),
  expired: detail('expired', { inviter: null }),
};

const none: ExpiryView = { kind: 'none', text: '–' };
const rel = (text: string, title: string, dateTime: string): ExpiryView => ({
  kind: 'relative',
  text,
  title,
  dateTime,
});
const exact = (text: string, dateTime: string): ExpiryView => ({ kind: 'exact', text, title: text, dateTime });

let seq = 0;
const row = (
  over: Partial<OrgInvitationRowView> & Pick<OrgInvitationRowView, 'status' | 'expires'>,
): OrgInvitationRowView => ({
  id: `d1000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  email: `person${seq}@example.com`,
  role: 'Member',
  access: 'Whole organization',
  invitedBy: 'Ada Lovelace',
  actions: over.status === 'pending' ? ['copy', 'resend', 'revoke'] : over.status === 'expired' ? ['resend'] : [],
  ...over,
});

export const orgInvitationRows: OrgInvitationRowView[] = [
  row({ status: 'pending', expires: rel('Expires in 2 days', '23 Nov 2026, 14:05', '2026-11-23T14:05:00Z') }),
  row({ status: 'pending', expires: rel('Expires in 5 hours', '21 Nov 2026, 19:05', '2026-11-21T19:05:00Z') }),
  row({ status: 'expired', expires: rel('Expired 1 day ago', '20 Nov 2026, 14:05', '2026-11-20T14:05:00Z') }),
  row({ status: 'expired', expires: exact('10 Nov 2026, 14:05', '2026-11-10T14:05:00Z') }),
  row({ status: 'accepted', expires: none }),
  row({ status: 'declined', expires: none }),
  row({ status: 'revoked', expires: none }),
  row({
    status: 'pending',
    role: 'Admin',
    access: 'api, web',
    expires: rel('Expires in 2 days', '23 Nov 2026, 14:05', '2026-11-23T14:05:00Z'),
  }),
  row({
    status: 'pending',
    email: `${'a-very-long-local-part-'.repeat(6)}@example-company-with-a-long-name.example.com`,
    expires: rel('Expires in 2 days', '23 Nov 2026, 14:05', '2026-11-23T14:05:00Z'),
  }),
  row({
    status: 'pending',
    invitedBy: null,
    expires: rel('Expires in 2 days', '23 Nov 2026, 14:05', '2026-11-23T14:05:00Z'),
  }),
];

/** `n` pending rows, newest first, for the paged stories. */
export function pagedInvitationRows(n: number): OrgInvitationRowView[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `e1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    email: `invitee${n - i}@example.com`,
    role: 'Member',
    access: 'Whole organization',
    status: 'pending' as const,
    expires: rel('Expires in 2 days', '23 Nov 2026, 14:05', '2026-11-23T14:05:00Z'),
    invitedBy: 'Ada Lovelace',
    actions: ['copy', 'resend', 'revoke'] as OrgInvitationRowView['actions'],
  }));
}

export const inviteRoleOptions: Record<'owner' | 'orgAdmin' | 'projectAdmin', InviteOption[]> = {
  owner: [
    { id: 'owner', label: 'Owner' },
    { id: 'admin', label: 'Admin' },
    { id: 'member', label: 'Member' },
    { id: 'viewer', label: 'Viewer' },
  ],
  orgAdmin: [
    { id: 'admin', label: 'Admin' },
    { id: 'member', label: 'Member' },
    { id: 'viewer', label: 'Viewer' },
  ],
  projectAdmin: [
    { id: 'admin', label: 'Admin' },
    { id: 'member', label: 'Member' },
    { id: 'viewer', label: 'Viewer' },
  ],
};

export const inviteProjectOptions: InviteOption[] = [
  { id: 'f1000000-0000-4000-8000-000000000001', label: 'api' },
  { id: 'f1000000-0000-4000-8000-000000000002', label: 'web' },
  { id: 'f1000000-0000-4000-8000-000000000003', label: 'worker' },
];

export const invitationLink = 'https://agentdesk.example/invitations/…';
