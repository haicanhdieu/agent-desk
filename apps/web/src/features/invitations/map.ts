import type { MyInvitationDto } from '@agentdesk/contracts';
import type { InvitationAcceptState } from '@/screens';
import type { InvitationCardView } from '@/mocks/types';
import { formatFullDate, formatShortDate } from './dates';

/** What the invitation grants: the whole org, or the names of the projects (shown as text only). */
export function accessLine(scope: MyInvitationDto['scope']): string {
  return scope.type === 'org' ? 'Whole organization' : scope.projects.map((p) => p.name).join(', ');
}

/** The welcome-page card; the inviter's name is kept as the API gave it, and a deleted inviter stays null. */
export function toInvitationCard(dto: MyInvitationDto): InvitationCardView {
  return {
    id: dto.id,
    orgName: dto.org.name,
    roleName: dto.role.name,
    access: accessLine(dto.scope),
    inviter: dto.invitedBy === null ? null : dto.invitedBy.name,
    expires: {
      text: formatShortDate(dto.expiresAt),
      title: formatFullDate(dto.expiresAt),
      dateTime: dto.expiresAt,
    },
  };
}

/** What the invitation link page shows for an invitation; `pending` starts idle, the route sets busy and the dialog. */
export function toAcceptState(dto: MyInvitationDto): InvitationAcceptState {
  switch (dto.status) {
    case 'pending':
      return {
        kind: 'pending',
        busy: null,
        confirmDecline: false,
        details: { ...toInvitationCard(dto), orgSlug: dto.org.slug, status: 'pending' },
      };
    case 'accepted':
      return { kind: 'accepted', orgName: dto.org.name, orgHref: `/o/${encodeURIComponent(dto.org.slug)}/projects` };
    case 'declined':
      return { kind: 'declined', invitationsHref: '/invitations' };
    case 'revoked':
      return { kind: 'revoked' };
    case 'expired':
      return { kind: 'expired', orgName: dto.org.name, inviter: dto.invitedBy === null ? null : dto.invitedBy.name };
  }
}
