import type { PlatformOrgDto } from '@agentdesk/contracts';

// Fixtures of the platform organizations directory: the cases its screens and e2e specs need.
const uuid = (n: number) => `b8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const owner = (n: number, name: string, handle: string | null) => ({
  userId: `user-owner-${String(n)}`,
  name,
  handle,
  email: `${handle ?? `owner${String(n)}`}@example.com`,
});

const base = { suspendedAt: null, lastActivityAt: '2026-11-20T09:00:00.000Z' } as const;

export const platformOrgDtoFixtures: PlatformOrgDto[] = [
  {
    ...base,
    // Three hours before the mock clock (SESSION_MOCK_NOW), so the directory reads "3 hours ago".
    lastActivityAt: '2026-11-19T11:20:00.000Z',
    id: uuid(1),
    name: 'Acme',
    slug: 'acme',
    memberCount: 4,
    createdAt: '2026-09-01T10:00:00.000Z',
    status: 'active',
    projectCount: 3,
    owner: owner(1, 'Alice Acme', 'alice'),
  },
  {
    // Two owners in the real data: the directory shows the earliest.
    ...base,
    id: uuid(2),
    name: 'Beta',
    slug: 'beta-labs',
    memberCount: 6,
    createdAt: '2026-09-15T10:00:00.000Z',
    status: 'active',
    projectCount: 2,
    owner: owner(2, 'Bea Tester', 'bea'),
  },
  {
    id: uuid(3),
    name: 'Orbit Systems',
    slug: 'orbit-systems',
    memberCount: 2,
    createdAt: '2026-08-10T10:00:00.000Z',
    status: 'suspended',
    suspendedAt: '2026-11-10T12:00:00.000Z',
    projectCount: 1,
    lastActivityAt: '2026-11-09T16:30:00.000Z',
    owner: owner(3, 'Omar Orbit', 'omar'),
  },
  {
    ...base,
    id: uuid(4),
    name: 'Ownerless Co',
    slug: 'ownerless',
    memberCount: 0,
    createdAt: '2026-10-20T10:00:00.000Z',
    status: 'active',
    projectCount: 0,
    owner: null,
  },
  {
    id: uuid(5),
    name: 'Quiet Works',
    slug: 'quiet-works',
    memberCount: 1,
    createdAt: '2026-10-25T10:00:00.000Z',
    status: 'active',
    suspendedAt: null,
    projectCount: 0,
    lastActivityAt: null,
    owner: owner(5, 'Quinn Quiet', null),
  },
  {
    ...base,
    id: uuid(6),
    name: 'The International Association of Extraordinarily Long Named Organizations and Partners',
    slug: 'international-association-long-named',
    memberCount: 12,
    createdAt: '2026-07-04T10:00:00.000Z',
    status: 'active',
    projectCount: 7,
    owner: owner(6, 'Lena Long', 'lena'),
  },
];
