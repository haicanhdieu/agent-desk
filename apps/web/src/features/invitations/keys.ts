/** Query keys of the user's own invitations; outside `['org', slug]` because they belong to no org yet. */
export const invitationKeys = {
  list: () => ['session', 'invitations'] as const,
  detail: (id: string) => ['session', 'invitations', id] as const,
};
