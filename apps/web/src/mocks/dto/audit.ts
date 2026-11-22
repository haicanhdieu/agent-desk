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
  }));
}
