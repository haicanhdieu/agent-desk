import {
  CreateInvitationRequest,
  can,
  type Access,
  type InvitationDto,
  type ProjectDto,
  type RoleDto,
} from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { revalidateLogic, useField, useForm, useStore, type ValidationErrorMap } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { projectAuditListKey } from '../projectAudit/queries';
import { isOrgMismatch } from '@/features/auth/orgResync';
import type { InviteDialogValues } from '@/components/InviteDialog';
import type { InviteOption } from '@/mocks/types';
import { GENERIC_FORM_ERROR } from '../desk/problem';
import { useCreateInvitation } from './mutations';

// The invite dialog's form (spec BR-27 to BR-29): TanStack Form validated with the contract's CreateInvitationRequest,
// first on submit and then on every change. Server problems land on the field their JSON Pointer names, else in a
// form banner. Nothing here reads the options from the server; the route passes what it loaded.

type InviteField = 'email' | 'roleId' | 'projectIds';

/** An org-scope grant of assignment:create: the inviter may invite to the whole org. */
export function projectsOnly(access: Access): boolean {
  return !access.grants.some(
    (g) => g.scope.type === 'org' && g.lines.some((l) => l.permission === 'assignment:create'),
  );
}

const isOwner = (access: Access) => access.grants.some((g) => g.scope.type === 'org' && g.roleKey === 'owner');

/** BR-29: owner only for an owner; no owner for an org admin; for a project admin the roles a project can hold. */
export function roleOptions(roles: RoleDto[], access: Access): InviteOption[] {
  const offered = projectsOnly(access)
    ? roles.filter((r) => r.key !== 'owner' && r.assignableScopes.includes('project'))
    : isOwner(access)
      ? roles
      : roles.filter((r) => r.key !== 'owner');
  return offered.map((r) => ({ id: r.id, label: r.name }));
}

/** BR-13: the Invite people dialog on a project's Members page offers Admin, Member and Viewer, never Owner. */
export function projectRoleOptions(roles: RoleDto[]): InviteOption[] {
  return (['admin', 'member', 'viewer'] as const).flatMap((key): InviteOption[] => {
    const r = roles.find((x) => x.key === key && x.assignableScopes.includes('project'));
    return r ? [{ id: r.id, label: r.name }] : [];
  });
}

/** BR-29: a project admin sees only the projects where they hold assignment:create. */
export function projectOptions(projects: ProjectDto[], access: Access): InviteOption[] {
  const offered = projectsOnly(access)
    ? projects.filter((p) => can(access, 'assignment:create', { projectId: p.id }))
    : projects;
  return offered.map((p) => ({ id: p.id, label: p.name }));
}

/** problem+json pointers into the create request body. */
export const INVITE_FIELD_POINTERS = {
  '/email': 'email',
  '/roleId': 'roleId',
  '/scope/projectIds': 'projectIds',
  '/projectIds': 'projectIds',
} as const satisfies Record<string, InviteField>;

const EMAIL_INVALID = 'Enter a valid email address.';
const EMAIL_TOO_LONG = 'Use 254 characters or fewer.';
const ROLE_REQUIRED = 'Choose a role.';
const PROJECT_REQUIRED = 'Choose at least one project.';

function toRequest(v: InviteDialogValues): unknown {
  return {
    email: v.email.trim(),
    roleId: v.roleId,
    scope: v.scope === 'org' ? { type: 'org' } : { type: 'project', projectIds: v.projectIds },
  };
}

/** The first message per field for the current values, in the form's own wording. */
export function validateInvite(value: InviteDialogValues) {
  const result = CreateInvitationRequest.safeParse(toRequest(value));
  if (result.success) return undefined;
  const fields: Partial<Record<InviteField, string>> = {};
  for (const issue of result.error.issues) {
    const [head, tail] = issue.path;
    if (head === 'email') fields.email ??= issue.code === 'too_big' ? EMAIL_TOO_LONG : EMAIL_INVALID;
    else if (head === 'roleId') fields.roleId ??= ROLE_REQUIRED;
    else if (head === 'scope' && tail === 'projectIds') fields.projectIds ??= PROJECT_REQUIRED;
  }
  return { fields };
}

export interface InviteProblem {
  fields: Partial<Record<InviteField, string>>;
  form?: string;
  /** The tab's org was switched elsewhere: a Toast, not a form message (T12). */
  orgSwitched?: true;
}

const POINTER_INDEX = /\/\d+$/;

/** Spreads a failed create over the form: pointers (an array index dropped) to fields, the rest to the banner. */
export function inviteProblem(e: unknown): InviteProblem {
  if (isOrgMismatch(e)) return { fields: {}, orgSwitched: true };
  if (!(e instanceof ApiError) || e.status === 0) return { fields: {}, form: GENERIC_FORM_ERROR };
  const fields: Partial<Record<InviteField, string>> = {};
  const unmapped: string[] = [];
  for (const err of e.errors ?? []) {
    const pointer = err.pointer.replace(POINTER_INDEX, '');
    const field = Object.entries(INVITE_FIELD_POINTERS).find(([p]) => p === pointer)?.[1];
    if (field === undefined) unmapped.push(err.detail);
    else fields[field] ??= err.detail;
  }
  if (Object.keys(fields).length > 0 && unmapped.length === 0) return { fields };
  return { fields, form: [e.detail ?? e.title, ...unmapped].join(' ') };
}

function messageOf(errorMap: ValidationErrorMap): string | undefined {
  if (typeof errorMap.onServer === 'string') return errorMap.onServer;
  return Object.values(errorMap).find((v): v is string => typeof v === 'string');
}

export interface InviteFormOptions {
  org: string;
  /** A project admin can only invite to projects. */
  projectsOnly: boolean;
  /** An org-switch failure: the route shows the Toast. */
  onOrgSwitched(): void;
  /** BR-13: the dialog opens on "Some projects" with this project the only one chosen. */
  fixedProjectId?: string;
}

export function useInviteForm({ org, projectsOnly: onlyProjects, onOrgSwitched, fixedProjectId }: InviteFormOptions) {
  const queryClient = useQueryClient();
  const create = useCreateInvitation(org);
  const [formError, setFormError] = useState<string>();
  const [created, setCreated] = useState<InvitationDto>();
  const defaultValues: InviteDialogValues = {
    email: '',
    roleId: '',
    scope: onlyProjects || fixedProjectId !== undefined ? 'projects' : 'org',
    projectIds: fixedProjectId === undefined ? [] : [fixedProjectId],
  };
  const form = useForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => validateInvite(value) },
    onSubmit: async ({ value, formApi }) => {
      try {
        const body = CreateInvitationRequest.parse(toRequest(value));
        setCreated(await create.mutateAsync(body));
        // The invitation's audit entry names this project: its log reads again.
        if (fixedProjectId !== undefined)
          void queryClient.invalidateQueries({ queryKey: projectAuditListKey(org, fixedProjectId) });
      } catch (e) {
        // The values stay as typed; only the messages change.
        const problem = inviteProblem(e);
        for (const name of ['email', 'roleId', 'projectIds'] as const) {
          const message = problem.fields[name];
          if (message !== undefined)
            formApi.setFieldMeta(name, (prev) => ({ ...prev, errorMap: { ...prev.errorMap, onServer: message } }));
        }
        setFormError(problem.form);
        if (problem.orgSwitched) onOrgSwitched();
      }
    },
  });

  const fields = {
    email: useField({ form, name: 'email' }),
    roleId: useField({ form, name: 'roleId' }),
    scope: useField({ form, name: 'scope' }),
    projectIds: useField({ form, name: 'projectIds' }),
  };
  const saving = useStore(form.store, (s) => s.isSubmitting);

  const clearServerError = (name: InviteField) => {
    if (fields[name].state.meta.errorMap.onServer !== undefined) fields[name].setErrorMap({ onServer: undefined });
  };

  const values: InviteDialogValues = {
    email: fields.email.state.value,
    roleId: fields.roleId.state.value,
    scope: fields.scope.state.value,
    projectIds: fields.projectIds.state.value,
  };
  const errors: Partial<Record<InviteField, string>> = {};
  for (const name of ['email', 'roleId', 'projectIds'] as const) {
    const message = messageOf(fields[name].state.meta.errorMap);
    if (message !== undefined) errors[name] = message;
  }

  return {
    values,
    errors,
    formError,
    saving,
    created,
    /** Sets the changed fields; a changed field drops its server message, and any change drops the banner. */
    change(next: InviteDialogValues) {
      let changed = false;
      if (next.email !== values.email) {
        changed = true;
        clearServerError('email');
        fields.email.handleChange(next.email);
      }
      if (next.roleId !== values.roleId) {
        changed = true;
        clearServerError('roleId');
        fields.roleId.handleChange(next.roleId);
      }
      if (next.scope !== values.scope) {
        changed = true;
        fields.scope.handleChange(next.scope);
      }
      if (next.projectIds.join() !== values.projectIds.join()) {
        changed = true;
        clearServerError('projectIds');
        fields.projectIds.handleChange(next.projectIds);
      }
      if (changed) setFormError(undefined);
    },
    submit() {
      if (form.state.isSubmitting) return;
      for (const name of ['email', 'roleId', 'projectIds'] as const) clearServerError(name);
      setFormError(undefined);
      void form.handleSubmit();
    },
  };
}
