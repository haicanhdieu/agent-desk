// Platform org detail tab views for the stories: the Projects and Members tables (BR-25).
export interface PlatformProjectRowView {
  id: string;
  name: string;
}

export interface PlatformMemberAssignmentView {
  assignmentId: string;
  /** "Owner (organization)" or "Member (Alpha)". */
  label: string;
}

export interface PlatformMemberRowView {
  userId: string;
  name: string | null;
  handle: string | null;
  email: string;
  assignments: PlatformMemberAssignmentView[];
}

const projectId = (n: number) => `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const platformProjectRows: PlatformProjectRowView[] = [
  { id: projectId(1), name: 'Alpha' },
  { id: projectId(2), name: 'Billing jobs' },
  { id: projectId(3), name: 'Storefront' },
];

export const pagedPlatformProjectRows: PlatformProjectRowView[] = Array.from({ length: 25 }, (_, i) => ({
  id: projectId(100 + i),
  name: `Project ${String(i + 1).padStart(2, '0')}`,
}));

const member = (
  n: number,
  name: string | null,
  handle: string | null,
  email: string,
  labels: string[],
): PlatformMemberRowView => ({
  userId: `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name,
  handle,
  email,
  assignments: labels.map((label, i) => ({
    assignmentId: `f1000000-0000-4000-8000-${String(n * 10 + i).padStart(12, '0')}`,
    label,
  })),
});

export const platformMemberRows: PlatformMemberRowView[] = [
  member(1, 'Lee Park', 'lee', 'lee@example.com', ['Owner (organization)']),
  member(2, 'Cleo Martin', 'cleo', 'cleo@example.com', ['Admin (organization)', 'Member (Alpha)']),
  member(3, 'Dana Wu', 'dana', 'dana@example.com', []),
  member(4, null, 'noor', 'noor@example.com', ['Viewer (Storefront)']),
];

export const pagedPlatformMemberRows: PlatformMemberRowView[] = Array.from({ length: 25 }, (_, i) =>
  member(
    100 + i,
    `Member ${String(i + 1).padStart(2, '0')}`,
    `member${i + 1}`,
    `member${i + 1}@example.com`,
    i % 3 === 0 ? [] : ['Member (Alpha)'],
  ),
);
