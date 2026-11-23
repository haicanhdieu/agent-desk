import { AddProjectMemberRequest, type ProjectMemberDto } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useForm, useStore } from '@tanstack/react-form';
import { useRef, useState } from 'react';
import type { MemberPickerOption } from '@/mocks/types';
import { isOrgMismatch, ORG_SWITCHED_MESSAGE } from '../auth/orgResync';
import { fieldErrorsFromProblem } from '../desk/problem';
import { useAddProjectMember } from './mutations';

export type AddField = 'userId' | 'roleId';
export type AddErrors = Partial<Record<AddField, string>>;
export interface AddFormError {
  title: string;
  detail?: string;
  requestId?: string;
}
export interface AddProblem {
  fields: AddErrors;
  form?: AddFormError;
  /** The person got a role on the project meanwhile (409). */
  conflict?: true;
}

const PERSON_REQUIRED = 'Choose a person.';
const ROLE_REQUIRED = 'Choose a role.';
const PERSON_GONE = 'This person is no longer in the organization.';
const CONFLICT: AddFormError = {
  title: 'This person already has a role on this project.',
  detail: 'Use Change role to change it.',
};
const POINTERS = { '/userId': 'userId', '/roleId': 'roleId' } as const satisfies Record<string, AddField>;

/** The first message per field, in the form's own wording; undefined when the request would be valid. */
export function validateAdd(value: { userId: string; roleId: string }): AddErrors | undefined {
  const result = AddProjectMemberRequest.safeParse(value);
  if (result.success) return undefined;
  const errors: AddErrors = {};
  for (const issue of result.error.issues) {
    if (issue.path[0] === 'userId') errors.userId ??= PERSON_REQUIRED;
    else if (issue.path[0] === 'roleId') errors.roleId ??= ROLE_REQUIRED;
  }
  return errors;
}

/** Spreads a failed add: 409 and 422 get the spec's copy; anything else is a banner with its request id. */
export function addProblem(e: unknown): AddProblem {
  // The org was switched in another tab (also a 409): not a role conflict.
  if (isOrgMismatch(e)) return { fields: {}, form: { title: ORG_SWITCHED_MESSAGE } };
  if (e instanceof ApiError && e.status === 409) return { fields: {}, form: CONFLICT, conflict: true };
  const spread = fieldErrorsFromProblem(e, POINTERS);
  const fields: AddErrors = {};
  if (spread.fields.userId !== undefined) fields.userId = PERSON_GONE;
  if (spread.fields.roleId !== undefined) fields.roleId = spread.fields.roleId;
  if (spread.form === undefined) return { fields };
  if (e instanceof ApiError && e.status !== 0) {
    return {
      fields,
      form: { title: e.title, ...(e.requestId !== undefined && { requestId: e.requestId }) },
    };
  }
  return { fields, form: { title: spread.form } };
}

/** The Add dialog's form: the values live in TanStack Form, checked with the contract's AddProjectMemberRequest on submit. */
export function useAddMemberForm(
  org: string,
  projectId: string,
  onAdded: (dto: ProjectMemberDto, roleName: string) => void,
) {
  const add = useAddProjectMember(org, projectId);
  const [picked, setPicked] = useState<MemberPickerOption | null>(null);
  const [errors, setErrors] = useState<AddErrors>({});
  const [formError, setFormError] = useState<AddFormError>();
  const [saving, setSaving] = useState(false);
  const form = useForm({ defaultValues: { userId: '', roleId: '' } });
  const roleId = useStore(form.store, (s) => s.values.roleId);
  const inFlight = useRef(false);

  const submit = async (roleName: (roleId: string) => string) => {
    if (inFlight.current) return;
    const value = form.state.values;
    const invalid = validateAdd(value);
    setFormError(undefined);
    setErrors(invalid ?? {});
    if (invalid) return;
    // Synchronous, before the request: two quick clicks send one request.
    inFlight.current = true;
    setSaving(true);
    try {
      const dto = await add.mutateAsync(AddProjectMemberRequest.parse(value));
      onAdded(dto, roleName(value.roleId));
    } catch (e) {
      const problem = addProblem(e);
      setErrors(problem.fields);
      setFormError(problem.form);
      if (problem.conflict) pick(null);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  function pick(option: MemberPickerOption | null) {
    setPicked(option);
    form.setFieldValue('userId', option?.userId ?? '');
    setErrors((prev) => ({ ...prev, userId: undefined }));
  }
  const setRole = (roleId: string) => {
    form.setFieldValue('roleId', roleId);
    setErrors((prev) => ({ ...prev, roleId: undefined }));
  };

  return { picked, pick, roleId, setRole, errors, formError, saving, submit };
}
