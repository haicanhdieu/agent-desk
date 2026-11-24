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

export const MemberUserId = z.string().min(1).max(255);

export const CreateAssignmentRequest = z.object({
  userId: MemberUserId,
  roleId: Id,
  scope: ScopeDto,
});
export type CreateAssignmentRequest = z.infer<typeof CreateAssignmentRequest>;

/** null = the member keeps no org role. */
export const UpdateMemberRoleRequest = z.object({ roleId: Id.nullable() });
export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequest>;

export const MEMBER_SEARCH_MAX = 100;
export const MembersListQuery = PageQuery.extend({
  q: z.string().trim().min(1).max(MEMBER_SEARCH_MAX).optional(),
  excludeProject: Id.optional(),
});
export type MembersListQuery = z.infer<typeof MembersListQuery>;

export const ProjectRoleDto = z.object({ assignmentId: Id, role: RoleRef });
export type ProjectRoleDto = z.infer<typeof ProjectRoleDto>;

/** A role the person holds on the whole organization; it applies to this project too and is managed in org Settings. */
export const OrgRoleDto = z.object({ role: RoleRef });
export type OrgRoleDto = z.infer<typeof OrgRoleDto>;

/**
 * One person with access to the project. `projectRoles` are the roles granted on this project, `orgRoles` the
 * org-scope roles that apply here (read-only for a project admin). `source` is 'project' when the person holds at
 * least one project-scope role (the row can be changed or removed), 'org' when the access is inherited only.
 */
export const ProjectMemberDto = z.object({
  userId: z.string(),
  name: z.string(),
  handle: z.string().nullable(),
  source: z.enum(['project', 'org']),
  projectRoles: z.array(ProjectRoleDto),
  orgRoles: z.array(OrgRoleDto),
});
export type ProjectMemberDto = z.infer<typeof ProjectMemberDto>;

export const AddProjectMemberRequest = z.object({ userId: MemberUserId, roleId: Id });
export type AddProjectMemberRequest = z.infer<typeof AddProjectMemberRequest>;

export const SetProjectRoleRequest = z.object({ roleId: Id });
export type SetProjectRoleRequest = z.infer<typeof SetProjectRoleRequest>;

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

/** The only source of an invitation's lifetime. */
export const INVITATION_EXPIRY_SECONDS = 172800;

export const InvitationStatus = z.enum(['pending', 'accepted', 'declined', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

export const InvitationListStatus = z.enum(['pending', 'accepted', 'declined', 'revoked', 'expired', 'all']);
export type InvitationListStatus = z.infer<typeof InvitationListStatus>;

export const InvitationListQuery = PageQuery.extend({ status: InvitationListStatus.default('pending') });
export type InvitationListQuery = z.infer<typeof InvitationListQuery>;

export const InvitationScopeDto = z.discriminatedUnion('type', [
  z.object({ type: z.literal('org') }),
  z.object({
    type: z.literal('project'),
    projects: z.array(z.object({ id: Id, name: z.string() })),
  }),
]);
export type InvitationScopeDto = z.infer<typeof InvitationScopeDto>;

export const InviterDto = z.object({ name: z.string(), handle: z.string() });
export type InviterDto = z.infer<typeof InviterDto>;

export const InvitationDto = z.object({
  id: Id,
  email: z.string(),
  role: RoleRef,
  scope: InvitationScopeDto,
  status: InvitationStatus,
  expiresAt: Timestamp,
  invitedBy: InviterDto.nullable(),
  createdAt: Timestamp,
  acceptedAt: Timestamp.nullable(),
});
export type InvitationDto = z.infer<typeof InvitationDto>;

const OrgRef = z.object({ id: Id, name: z.string(), slug: z.string() });

/** An invitation as its invitee sees it. Carries no link or token. */
export const MyInvitationDto = z.object({
  id: Id,
  org: OrgRef,
  role: z.object({ key: z.string(), name: z.string() }),
  scope: InvitationScopeDto,
  invitedBy: InviterDto.nullable(),
  expiresAt: Timestamp,
  status: InvitationStatus,
});
export type MyInvitationDto = z.infer<typeof MyInvitationDto>;

export const AcceptInvitationResponse = z.object({ org: OrgRef });
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponse>;

export const ChecklistStepKey = z.enum(['connect_code_host', 'create_project', 'add_agent', 'add_rule']);
export type ChecklistStepKey = z.infer<typeof ChecklistStepKey>;

export const OrgChecklistDto = z.object({
  complete: z.boolean(),
  projectId: Id.nullable(),
  steps: z.array(z.object({ key: ChecklistStepKey, done: z.boolean() })),
});
export type OrgChecklistDto = z.infer<typeof OrgChecklistDto>;

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
