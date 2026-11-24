// Organizations directory views for the stories: what the platform Organizations page shows per org.
export type OrgStatusView = 'active' | 'suspended';

export interface PlatformOrgRowView {
  id: string;
  name: string;
  slug: string;
  href: string;
  owner: string | null;
  members: number;
  projects: number;
  lastActivity: { label: string; title: string } | null;
  status: OrgStatusView;
  created: { label: string; title: string };
}

const row = (
  n: number,
  over: Partial<PlatformOrgRowView> & Pick<PlatformOrgRowView, 'name' | 'slug'>,
): PlatformOrgRowView => ({
  id: `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  href: `/o/${over.slug}`,
  owner: `owner@${over.slug}.example.com`,
  members: 5,
  projects: 2,
  lastActivity: { label: '5 min ago', title: 'Nov 23, 2026, 10:00 UTC' },
  status: 'active',
  created: { label: 'Nov 1, 2026', title: 'Nov 1, 2026, 08:00 UTC' },
  ...over,
});

export const platformOrgRows: PlatformOrgRowView[] = [
  row(1, { name: 'Acme Inc', slug: 'acme' }),
  row(2, {
    name: 'Globex',
    slug: 'globex',
    status: 'suspended',
    lastActivity: { label: '3 days ago', title: 'Nov 20, 2026, 16:45 UTC' },
  }),
  row(3, { name: 'Initech', slug: 'initech', owner: null, members: 0, projects: 0 }),
  row(4, { name: 'Umbrella', slug: 'umbrella', lastActivity: null, members: 1, projects: 0 }),
  row(5, {
    name: 'The International Consolidated Holding Company of Northern and Southern Industries',
    slug: 'consolidated-holding',
  }),
];

export const pagedPlatformOrgRows: PlatformOrgRowView[] = Array.from({ length: 25 }, (_, i) =>
  row(100 + i, {
    name: `Organization ${String(i + 1).padStart(2, '0')}`,
    slug: `org-${String(i + 1).padStart(2, '0')}`,
    status: i % 7 === 3 ? 'suspended' : 'active',
  }),
);
