import { createFileRoute, redirect } from '@tanstack/react-router';
import { InvitationsSearch } from '@/features/orgInvitations/search';

// The old Invitations URL now lives inside Settings; the filter and the page go with it. The new route checks access.
export const Route = createFileRoute('/o/$org/invitations')({
  validateSearch: InvitationsSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/o/$org/settings/invitations', params: { org: params.org }, search, replace: true });
  },
});
