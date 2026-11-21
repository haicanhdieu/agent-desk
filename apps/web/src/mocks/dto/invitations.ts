import type { MyInvitationDto, OrgChecklistDto } from '@agentdesk/contracts';
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
