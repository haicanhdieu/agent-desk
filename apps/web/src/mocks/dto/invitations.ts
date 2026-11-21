import type { InvitationDto, MyInvitationDto, OrgChecklistDto } from '@agentdesk/contracts';
import { roleFixtures } from './access';
import { ids } from './ids';

// Onboarding fixtures: the invitee's view of invitations in each state, and the first-run checklist at three stages.
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

const org = { id: uuid('b5000000', 1), name: 'Acme Robotics', slug: 'acme-robotics' };
const role = { key: 'member', name: 'Member' };
const ada = { name: 'Ada Lovelace', handle: 'ada' };

const base = {
  org,
  role,
  scope: { type: 'org' },
  invitedBy: ada,
  expiresAt: '2026-11-14T09:00:00.000Z',
  status: 'pending',
} as const satisfies Omit<MyInvitationDto, 'id'>;

export const myInvitationFixtures: Record<
  | 'pending'
  | 'pendingProjects'
  | 'pendingInviterHandle'
  | 'pendingInviterDeleted'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired',
  MyInvitationDto
> = {
  pending: { ...base, id: uuid('b4000000', 1) },
  pendingProjects: {
    ...base,
    id: uuid('b4000000', 2),
    scope: {
      type: 'project',
      projects: [
        { id: ids.project.invoicerApi, name: 'invoicer-api' },
        { id: ids.project.invoicerWeb, name: 'invoicer-web' },
      ],
    },
  },
  pendingInviterHandle: { ...base, id: uuid('b4000000', 3), invitedBy: { name: 'ada', handle: 'ada' } },
  pendingInviterDeleted: { ...base, id: uuid('b4000000', 4), invitedBy: null },
  accepted: { ...base, id: uuid('b4000000', 5), status: 'accepted' },
  declined: { ...base, id: uuid('b4000000', 6), status: 'declined' },
  revoked: { ...base, id: uuid('b4000000', 7), status: 'revoked' },
  expired: { ...base, id: uuid('b4000000', 8), status: 'expired', expiresAt: '2026-11-10T09:00:00.000Z' },
};

export const checklistFixtures: Record<'none' | 'partial' | 'complete', OrgChecklistDto> = {
  none: {
    complete: false,
    projectId: null,
    steps: [
      { key: 'connect_code_host', done: false },
      { key: 'create_project', done: false },
      { key: 'add_agent', done: false },
      { key: 'add_rule', done: false },
    ],
  },
  partial: {
    complete: false,
    projectId: ids.project.invoicerApi,
    steps: [
      { key: 'connect_code_host', done: true },
      { key: 'create_project', done: true },
      { key: 'add_agent', done: false },
      { key: 'add_rule', done: false },
    ],
  },
  complete: {
    complete: true,
    projectId: ids.project.invoicerApi,
    steps: [
      { key: 'connect_code_host', done: true },
      { key: 'create_project', done: true },
      { key: 'add_agent', done: true },
      { key: 'add_rule', done: true },
    ],
  },
};

/** The fixed clock of the invitation list fixtures and the mock e2e specs that pin `page.clock` to it. */
export const INVITATIONS_MOCK_NOW = '2026-11-23T14:05:00.000Z';

const roleRef = (key: 'member' | 'admin' | 'viewer'): InvitationDto['role'] => {
  const role = roleFixtures.find((r) => r.key === key);
  if (!role) throw new Error(`role fixture ${key} missing`);
  return { id: role.id, key: role.key, name: role.name };
};

const orgBase = {
  role: roleRef('member'),
  scope: { type: 'org' },
  invitedBy: { name: 'Ada Lovelace', handle: 'ada' },
  createdAt: '2026-11-23T14:00:00.000Z',
  expiresAt: '2026-11-25T14:00:00.000Z',
  acceptedAt: null,
} as const satisfies Omit<InvitationDto, 'id' | 'email' | 'status'>;

/** An org's invitations as its inviters see them at `INVITATIONS_MOCK_NOW`: one row per status, two pending. */
export const orgInvitationFixtures: InvitationDto[] = [
  { ...orgBase, id: uuid('b3100000', 1), email: 'p@x.dev', status: 'pending' },
  {
    ...orgBase,
    id: uuid('b3100000', 2),
    email: 'q@x.dev',
    status: 'pending',
    role: roleRef('viewer'),
    scope: { type: 'project', projects: [{ id: ids.project.invoicerApi, name: 'invoicer-api' }] },
    expiresAt: '2026-11-23T19:05:00.000Z',
  },
  {
    ...orgBase,
    id: uuid('b3100000', 3),
    email: 'a@x.dev',
    status: 'accepted',
    acceptedAt: '2026-11-23T14:02:00.000Z',
  },
  { ...orgBase, id: uuid('b3100000', 4), email: 'd@x.dev', status: 'declined' },
  { ...orgBase, id: uuid('b3100000', 5), email: 'r@x.dev', status: 'revoked' },
  {
    ...orgBase,
    id: uuid('b3100000', 6),
    email: 'e@x.dev',
    status: 'expired',
    createdAt: '2026-11-20T14:00:00.000Z',
    expiresAt: '2026-11-22T14:00:00.000Z',
  },
];
