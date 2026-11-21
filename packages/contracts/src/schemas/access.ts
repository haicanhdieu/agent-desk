import { z } from 'zod';
import { PermissionCondition, Permission, ScopeType } from '../access';
import { Id, Timestamp } from './common';
import { PageQuery } from './page';

export const ScopeDto = z.discriminatedUnion('type', [
  z.object({ type: z.literal('org') }),
  z.object({ type: z.literal('project'), projectId: Id }),
]);
export type ScopeDto = z.infer<typeof ScopeDto>;

export const RoleRef = z.object({ id: Id, key: z.string(), name: z.string() });
export type RoleRef = z.infer<typeof RoleRef>;

export const PermissionLineDto = z.object({
  permission: Permission,
  condition: PermissionCondition,
});
export type PermissionLineDto = z.infer<typeof PermissionLineDto>;

export const RoleDto = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  builtIn: z.boolean(),
  assignableScopes: z.array(ScopeType),
  permissions: z.array(PermissionLineDto),
});
export type RoleDto = z.infer<typeof RoleDto>;

export const AssignmentDto = z.object({
  id: Id,
  userId: z.string(),
  role: RoleRef,
  scope: ScopeDto,
  grantedBy: z.string().nullable(),
  grantedAt: Timestamp,
});
export type AssignmentDto = z.infer<typeof AssignmentDto>;

export const CreateAssignmentRequest = z.object({
  userId: z.string().min(1).max(255),
  roleId: Id,
  scope: ScopeDto,
});
export type CreateAssignmentRequest = z.infer<typeof CreateAssignmentRequest>;

export const AssignmentListQuery = PageQuery.extend({ projectId: Id.optional() });
export type AssignmentListQuery = z.infer<typeof AssignmentListQuery>;

export const InvitationEmail = z
  .email()
  .max(254)
  .transform((e) => e.toLowerCase());
export type InvitationEmail = z.infer<typeof InvitationEmail>;

export const InvitationScopeRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('org') }),
  z.object({
    type: z.literal('project'),
    projectIds: z
      .array(Id)
      .min(1)
      .max(100)
      .transform((ids) => [...new Set(ids)]),
  }),
]);
export type InvitationScopeRequest = z.infer<typeof InvitationScopeRequest>;

export const CreateInvitationRequest = z.object({
  email: InvitationEmail,
  roleId: Id,
  scope: InvitationScopeRequest,
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

export const InvitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

export const InvitationDto = z.object({
  id: Id,
  email: z.string(),
  role: RoleRef,
  scope: z.discriminatedUnion('type', [
    z.object({ type: z.literal('org') }),
    z.object({
      type: z.literal('project'),
      projects: z.array(z.object({ id: Id, name: z.string() })),
    }),
  ]),
  status: InvitationStatus,
  expiresAt: Timestamp,
  invitedBy: z.string(),
  createdAt: Timestamp,
  acceptedAt: Timestamp.nullable(),
});
export type InvitationDto = z.infer<typeof InvitationDto>;

export const MemberDto = z.object({
  userId: z.string(),
  handle: z.string().nullable(),
  name: z.string(),
  assignments: z.array(AssignmentDto),
});
export type MemberDto = z.infer<typeof MemberDto>;

export const AccessDto = z.object({
  userId: z.string(),
  platformAdmin: z.boolean(),
  assignments: z.array(
    z.object({
      roleKey: z.string(),
      scope: ScopeDto,
      permissions: z.array(PermissionLineDto),
    }),
  ),
});
export type AccessDto = z.infer<typeof AccessDto>;
