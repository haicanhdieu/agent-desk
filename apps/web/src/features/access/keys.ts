/** Query keys of the access area: the user's grants, session-wide or in one org. */
export const accessKeys = {
  session: () => ['session', 'access'] as const,
  org: (org: string) => ['org', org, 'access'] as const,
};
