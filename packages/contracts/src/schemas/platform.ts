import { z } from 'zod';
import { OrgStatus } from '../enums';
import { ORG_STATUS_REASON_MAX } from '../org-context';
import { OrgSlug } from '../slug';
import { AssignmentDto, InvitationDto, InvitationEmail, InviterDto, RoleDto } from './access';
import { Id, Timestamp } from './common';
import { PageQuery } from './page';

export const OrgName = z.string().min(1).max(100);
export type OrgName = z.infer<typeof OrgName>;

export const CreateOrgRequest = z.object({ name: OrgName, slug: OrgSlug });
export type CreateOrgRequest = z.infer<typeof CreateOrgRequest>;

export const UpdateOrgRequest = z
  .object({ name: OrgName.optional(), slug: OrgSlug.optional() })
  .refine((r) => r.name !== undefined || r.slug !== undefined, { message: 'Send a name or a slug' });
export type UpdateOrgRequest = z.infer<typeof UpdateOrgRequest>;

export const OrgDto = z.object({ id: Id, name: z.string(), slug: z.string() });
export type OrgDto = z.infer<typeof OrgDto>;

export const CreateOrgResponse = z.object({ id: Id, name: z.string(), slug: z.string() });
export type CreateOrgResponse = z.infer<typeof CreateOrgResponse>;

export const PlatformOrgOwnerDto = z.object({
  userId: z.string(),
  name: z.string(),
  handle: z.string().nullable(),
  email: z.string(),
});
export type PlatformOrgOwnerDto = z.infer<typeof PlatformOrgOwnerDto>;

export const PlatformOrgDto = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  memberCount: z.number().int().min(0),
  createdAt: Timestamp,
  status: OrgStatus,
  suspendedAt: Timestamp.nullable(),
  projectCount: z.number().int().min(0),
  lastActivityAt: Timestamp.nullable(),
  owner: PlatformOrgOwnerDto.nullable(),
});
export type PlatformOrgDto = z.infer<typeof PlatformOrgDto>;

export const PlatformOrgSuspensionDto = z.object({
  at: Timestamp,
  reason: z.string(),
  by: z.object({ userId: z.string(), name: z.string(), handle: z.string().nullable() }).nullable(),
});
export type PlatformOrgSuspensionDto = z.infer<typeof PlatformOrgSuspensionDto>;

export const PlatformOrgDetailDto = PlatformOrgDto.extend({ suspension: PlatformOrgSuspensionDto.nullable() });
export type PlatformOrgDetailDto = z.infer<typeof PlatformOrgDetailDto>;

export const ORG_SEARCH_MAX = 100;
export const PlatformOrgListQuery = PageQuery.extend({
  q: z.string().trim().max(ORG_SEARCH_MAX).optional(),
  status: OrgStatus.optional(),
});
export type PlatformOrgListQuery = z.infer<typeof PlatformOrgListQuery>;

export const PlatformProjectDto = z.object({ id: Id, name: z.string() });
export type PlatformProjectDto = z.infer<typeof PlatformProjectDto>;

export const PlatformMemberDto = z.object({
  userId: z.string(),
  handle: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  assignments: z.array(AssignmentDto),
});
export type PlatformMemberDto = z.infer<typeof PlatformMemberDto>;

export const PlatformAdminDto = z.object({
  id: Id,
  email: z.string(),
  userId: z.string().nullable(),
  name: z.string().nullable(),
  handle: z.string().nullable(),
  grantedAt: Timestamp,
  grantedBy: InviterDto.nullable(),
  /** True only on the one verified entry that is the sole working admin: the entry that cannot be revoked. */
  lastWorkingAdmin: z.boolean(),
});
export type PlatformAdminDto = z.infer<typeof PlatformAdminDto>;

export const PlatformSessionDto = z.object({ platformAdmin: z.boolean() });
export type PlatformSessionDto = z.infer<typeof PlatformSessionDto>;

export const GrantPlatformAdminRequest = z.object({ email: z.string().trim().pipe(InvitationEmail) }).strict();
export type GrantPlatformAdminRequest = z.infer<typeof GrantPlatformAdminRequest>;

export const PlatformRoleDto = z.object({ ...RoleDto.shape });
export type PlatformRoleDto = z.infer<typeof PlatformRoleDto>;

export const PlatformAssignmentDto = z.object({ ...AssignmentDto.shape });
export type PlatformAssignmentDto = z.infer<typeof PlatformAssignmentDto>;

export const PlatformInvitationDto = z.object({ ...InvitationDto.shape });
export type PlatformInvitationDto = z.infer<typeof PlatformInvitationDto>;

export const OrgStatusChangeRequest = z
  .object({ reason: z.string().trim().min(1).max(ORG_STATUS_REASON_MAX) })
  .strict();
export type OrgStatusChangeRequest = z.infer<typeof OrgStatusChangeRequest>;

export const PlatformAuditAction = z.enum([
  'platform_admin.granted',
  'platform_admin.revoked',
  'org.created',
  'org.updated',
  'org.suspended',
  'org.reactivated',
  'assignment.granted',
  'assignment.revoked',
  'invitation.created',
  'invitation.resent',
  'invitation.revoked',
]);
export type PlatformAuditAction = z.infer<typeof PlatformAuditAction>;
