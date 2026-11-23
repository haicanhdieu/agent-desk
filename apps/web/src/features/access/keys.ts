/** Query keys of the access area: the user's grants, session-wide or in one org. */
export const accessKeys = {
  session: () => ['session', 'access'] as const,
  /** Whether the user is a platform admin: session-wide, outside `['org', slug]` (it survives an org switch). */
  platform: () => ['session', 'platform'] as const,
  org: (org: string) => ['org', org, 'access'] as const,
};
