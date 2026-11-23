import { InvitationListStatus } from '@agentdesk/contracts';
import { PageSearch } from '@/app/pagination';

/** `?status=` is a filter name; a bad value reads as Pending, and Pending is left out of the URL. */
export const InvitationsSearch = PageSearch.extend({
  status: InvitationListStatus.optional().catch(undefined),
});
