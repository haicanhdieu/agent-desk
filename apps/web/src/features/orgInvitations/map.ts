import type { InvitationDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { ORG_SWITCHED_MESSAGE, isOrgMismatch } from '@/features/auth/orgResync';
import { accessLine } from '@/features/invitations/map';
import { expiresView } from '@/features/invitations/dates';
import type { OrgInvitationRowView } from '@/mocks/types';

/** One table row. Copy, Resend and Revoke on pending; Resend alone on expired; no menu on a final row (BR-19). */
export function toOrgInvitationRow(dto: InvitationDto, now: Date): OrgInvitationRowView {
  const actions: OrgInvitationRowView['actions'] =
    dto.status === 'pending' ? ['copy', 'resend', 'revoke'] : dto.status === 'expired' ? ['resend'] : [];
  return {
    id: dto.id,
    email: dto.email,
    role: dto.role.name,
    access: accessLine(dto.scope),
    status: dto.status,
    expires: expiresView(dto.expiresAt, dto.status, now),
    invitedBy: dto.invitedBy === null ? null : dto.invitedBy.name,
    actions,
  };
}

/**
 * The toast title of a failed Resend or Revoke: the `/email` field detail ("already invited", BR-50); on a 409 the
 * sentence the API sends as the detail (the mock sends it as the title); otherwise the problem title.
 */
export function failureTitle(e: unknown): string {
  if (isOrgMismatch(e)) return ORG_SWITCHED_MESSAGE;
  if (e instanceof ApiError) {
    const email = e.errors?.find((f) => f.pointer === '/email');
    if (email) return email.detail;
    return e.status === 409 ? (e.detail ?? e.title) : e.title;
  }
  return 'Something went wrong';
}
