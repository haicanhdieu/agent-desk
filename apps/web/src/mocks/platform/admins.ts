// Platform admins table views for the stories: what the Platform admins page shows per entry.
export interface PlatformAdminRowView {
  id: string;
  email: string;
  name: string | null;
  handle: string | null;
  addedAt: { label: string; title: string };
  addedBy: string | null;
  you: boolean;
  /** A seeded email with no account yet (BR-7). */
  neverSignedIn: boolean;
  /** The only admin who can sign in: Revoke is disabled. */
  lastWorkingAdmin: boolean;
}

const row = (
  n: number,
  over: Partial<PlatformAdminRowView> & Pick<PlatformAdminRowView, 'email'>,
): PlatformAdminRowView => ({
  id: `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: null,
  handle: null,
  addedAt: { label: 'Nov 20, 2026', title: 'Nov 20, 2026, 09:00 UTC' },
  addedBy: null,
  you: false,
  neverSignedIn: false,
  lastWorkingAdmin: false,
  ...over,
});

export const platformAdminRows: PlatformAdminRowView[] = [
  row(1, { email: 'alice@example.com', name: 'Alice Doe', handle: 'alice', you: true }),
  row(2, {
    email: 'grace@example.com',
    name: 'Grace Hopper',
    handle: 'grace',
    addedBy: 'alice@example.com',
    addedAt: { label: 'Nov 21, 2026', title: 'Nov 21, 2026, 14:30 UTC' },
  }),
  row(3, { email: 'new.hire@example.com', neverSignedIn: true, addedBy: 'alice@example.com' }),
];

export const pagedPlatformAdminRows: PlatformAdminRowView[] = Array.from({ length: 25 }, (_, i) =>
  i === 0
    ? row(100, { email: 'alice@example.com', name: 'Alice Doe', handle: 'alice', you: true })
    : row(100 + i, {
        email: `admin${i}@example.com`,
        name: `Admin ${String(i).padStart(2, '0')}`,
        handle: `admin${i}`,
        addedBy: 'alice@example.com',
      }),
);
