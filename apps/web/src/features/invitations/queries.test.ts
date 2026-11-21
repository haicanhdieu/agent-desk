import { describe, expect, it } from 'vitest';
import { myInvitationQuery, myInvitationsQuery } from './queries';
import { invitationKeys } from './keys';

describe('invitation query keys', () => {
  it('pins the keys outside the org cache', () => {
    expect(invitationKeys.list()).toEqual(['session', 'invitations']);
    expect(invitationKeys.detail('inv-1')).toEqual(['session', 'invitations', 'inv-1']);
    expect(myInvitationsQuery.queryKey).toEqual(['session', 'invitations']);
    expect(myInvitationQuery('inv-1').queryKey).toEqual(['session', 'invitations', 'inv-1']);
  });
});
