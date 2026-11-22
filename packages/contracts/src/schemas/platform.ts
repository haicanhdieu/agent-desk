import { z } from 'zod';
import { OrgSlug } from '../slug';
import { AssignmentDto, InvitationDto, InvitationEmail, InviterDto, RoleDto } from './access';
import { Id, Timestamp } from './common';

export const OrgName = z.string().min(1).max(100);
export type OrgName = z.infer<typeof OrgName>;

export const CreateOrgRequest = z.object({ name: OrgName, slug: OrgSlug });
export type CreateOrgRequest = z.infer<typeof CreateOrgRequest>;

export const CreateOrgResponse = z.object({ id: Id, name: z.string(), slug: z.string() });
export type CreateOrgResponse = z.infer<typeof CreateOrgResponse>;

export const PlatformOrgDto = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  memberCount: z.number().int().min(0),
  createdAt: Timestamp,
});
export type PlatformOrgDto = z.infer<typeof PlatformOrgDto>;

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
});
export type PlatformAdminDto = z.infer<typeof PlatformAdminDto>;

export const GrantPlatformAdminRequest = z.object({ email: z.string().trim().pipe(InvitationEmail) }).strict();
export type GrantPlatformAdminRequest = z.infer<typeof GrantPlatformAdminRequest>;

export const PlatformRoleDto = z.object({ ...RoleDto.shape });
export type PlatformRoleDto = z.infer<typeof PlatformRoleDto>;

export const PlatformAssignmentDto = z.object({ ...AssignmentDto.shape });
export type PlatformAssignmentDto = z.infer<typeof PlatformAssignmentDto>;

export const PlatformInvitationDto = z.object({ ...InvitationDto.shape });
export type PlatformInvitationDto = z.infer<typeof PlatformInvitationDto>;
