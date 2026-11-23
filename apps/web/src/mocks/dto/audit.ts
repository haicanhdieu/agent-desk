import type { AuditEntryDto } from '@agentdesk/contracts';
import { ids } from './ids';

// Audit fixtures: one entry per known action shape, newest first, times relative to AUDIT_MOCK_NOW.
export const AUDIT_MOCK_NOW = '2026-11-22T11:00:00.000Z';

const uuid = (n: number) => `b5000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minutesAgo: number) => new Date(Date.parse(AUDIT_MOCK_NOW) - minutesAgo * 60_000).toISOString();

const alice = { userId: ids.user.alice, name: 'Alice Doe', handle: 'alice' };
const priya = { userId: 'user-tenant-2', name: 'Priya Raman', handle: 'priya' };
const member = (label: string) => ({ type: 'user', id: 'user-tenant-4', label });

let seq = 0;
const entry = (minutesAgo: number, over: Partial<AuditEntryDto>): AuditEntryDto => ({
  id: uuid(++seq),
  at: at(minutesAgo),
  actor: alice,
  actorKind: 'member',
  action: 'member.role_changed',
  target: { type: null, id: null, label: null },
  changes: [],
  projects: [],
  ...over,
});

export const auditEntryFixtures: AuditEntryDto[] = [
  entry(2, {
    target: member('Cleo Martin'),
    changes: [{ field: 'role', from: 'Admin', to: 'Member' }],
  }),
  entry(30, {
    target: member('Ben Okafor'),
    changes: [{ field: 'role', from: 'Admin', to: 'Owner' }],
  }),
  entry(90, {
    action: 'org.updated',
    target: { type: 'org', id: null, label: 'Harbor Labs' },
    changes: [{ field: 'slug', from: 'harbor', to: 'harbor-labs' }],
  }),
  entry(180, {
    action: 'org.updated',
    target: { type: 'org', id: null, label: 'Harbor Labs' },
    changes: [{ field: 'name', from: 'Harbor', to: 'Harbor Labs' }],
  }),
  entry(1500, {
    action: 'member.removed',
    target: member('Dana Wu'),
    changes: [{ field: 'role', from: 'Member', to: null }],
  }),
  entry(2000, {
    action: 'invitation.created',
    target: { type: 'invitation', id: uuid(900), label: 'sam.reyes@contractor.io' },
    changes: [{ field: 'role', from: null, to: 'Viewer' }],
    projects: [
      { id: ids.project.invoicerApi, name: 'invoicer-api' },
      { id: ids.project.invoicerWeb, name: 'invoicer-web' },
    ],
  }),
  entry(3000, {
    action: 'POST orgs.create',
    target: { type: null, id: null, label: null },
  }),
  entry(4000, {
    actor: { userId: 'user-platform', name: 'Pat Platform', handle: 'pat' },
    actorKind: 'platform_admin',
    action: 'member.role_changed',
    target: member('Priya Raman'),
    changes: [{ field: 'role', from: null, to: 'Owner' }],
  }),
  entry(5000, {
    actor: null,
    actorKind: null,
    action: 'member.role_changed',
    target: member('Cleo Martin'),
    changes: [{ field: 'role', from: 'Viewer', to: 'Member' }],
  }),
  entry(6000, {
    actor: priya,
    action: 'invitation.created',
    target: { type: 'invitation', id: uuid(901), label: `<b>${'long-invitee-'.repeat(8)}</b>@example.com` },
    changes: [{ field: 'role', from: null, to: 'Member' }],
  }),
];

/** `n` role-change entries, newest first, for the paged stories. */
export function pagedAuditFixtures(n: number): AuditEntryDto[] {
  return Array.from({ length: n }, (_, i) => ({
    id: uuid(1000 + i),
    at: at(i + 1),
    actor: alice,
    actorKind: 'member' as const,
    action: 'member.role_changed',
    target: member(`Member ${n - i}`),
    changes: [{ field: 'role' as const, from: 'Member', to: 'Admin' }],
    projects: [],
  }));
}

// Project space (invoicer-api is P): the project Audit log fixtures. Invitation rows carry the listed projects the viewer can see.
const P = ids.project.invoicerApi;
const proj = (id: string, name: string) => ({ id, name });
const refs = {
  billing: proj(ids.project.billingJobs, 'billing-jobs'),
  docs: proj(ids.project.docsSite, 'docs-site'),
  api: proj(P, 'invoicer-api'),
  web: proj(ids.project.invoicerWeb, 'invoicer-web'),
  store: proj(ids.project.storefront, 'storefront'),
};
const lee = { userId: ids.user.alice, name: 'Lee Park', handle: 'lee' };
const kim = { userId: 'user-tenant-1', name: 'Kim Hale', handle: 'kim' };
const invitee = (n: number, label: string | null) => ({ type: 'invitation', id: uuid(n), label });
const role = (from: string | null, to: string | null): AuditEntryDto['changes'] => [{ field: 'role', from, to }];

/** P's audit, newest first. Another project's name or id shows only in `projects` of a fully visible invitation. */
export const projectAuditFixtures: AuditEntryDto[] = [
  entry(3, {
    actor: lee,
    action: 'assignment.granted',
    target: member('Mira Chen'),
    changes: role(null, 'Member'),
  }),
  entry(25, {
    actor: lee,
    action: 'project_member.role_changed',
    target: member('Cleo Martin'),
    changes: role('Member', 'Admin'),
  }),
  entry(70, {
    actor: lee,
    action: 'project_member.removed',
    target: member('Dana Wu'),
    changes: role('Viewer', null),
  }),
  entry(150, {
    actor: kim,
    action: 'invitation.created',
    target: invitee(910, 'sam.reyes@contractor.io'),
    changes: role(null, 'Viewer'),
    projects: [refs.api, refs.web],
  }),
  entry(240, {
    actor: kim,
    action: 'invitation.created',
    target: invitee(911, 'wide.access@contractor.io'),
    changes: role(null, 'Member'),
    projects: [refs.billing, refs.docs, refs.api, refs.web, refs.store],
  }),
  entry(300, {
    actor: kim,
    action: 'invitation.created',
    target: invitee(912, null),
    changes: role(null, 'Viewer'),
    projects: [refs.api],
  }),
  entry(420, {
    actor: kim,
    action: 'invitation.expired',
    target: invitee(913, 'sam.reyes@contractor.io'),
    projects: [refs.api],
  }),
  entry(600, {
    actor: kim,
    action: 'invitation.expired',
    target: invitee(914, null),
    projects: [refs.api],
  }),
  entry(900, { actor: kim, action: 'PUT desk.agent.put', target: { type: null, id: null, label: null } }),
  entry(1200, {
    actor: null,
    actorKind: null,
    action: 'project_member.role_changed',
    target: member('Cleo Martin'),
    changes: role('Viewer', 'Member'),
  }),
];

/** Entries of invoicer-web, never shown in P's log. */
export const otherProjectAuditFixtures: AuditEntryDto[] = [
  entry(10, {
    actor: kim,
    action: 'project_member.role_changed',
    target: member('Ben Okafor'),
    changes: role('Viewer', 'Admin'),
  }),
  entry(40, {
    actor: kim,
    action: 'invitation.created',
    target: invitee(915, 'eli@contractor.io'),
    changes: role(null, 'Viewer'),
    projects: [refs.web],
  }),
];

/** 25 role-change entries of P, newest first, for the paged boards. */
export const pagedProjectAuditFixtures: AuditEntryDto[] = Array.from({ length: 25 }, (_, i) => ({
  id: uuid(2000 + i),
  at: at(i + 1),
  actor: lee,
  actorKind: 'member' as const,
  action: 'project_member.role_changed',
  target: member(`Member ${25 - i}`),
  changes: role('Member', 'Admin'),
  projects: [],
}));
