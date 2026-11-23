import { UpdateOrgRequest } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { revalidateLogic, useField, useForm, useStore, type ValidationErrorMap } from '@tanstack/react-form';
import { ORG_SWITCHED_MESSAGE, isOrgMismatch } from '../auth/orgResync';
import { GENERIC_FORM_ERROR } from '../desk/problem';

// The General form (spec BR-14 to BR-17): TanStack Form validated with the contract's UpdateOrgRequest, first on
// submit and then on every change. The API's 400/409 stay the source of truth: they land on the field their JSON
// Pointer names, else in a form banner.

export interface GeneralValues {
  name: string;
  slug: string;
}
export type GeneralField = keyof GeneralValues;
type FieldErrors = Partial<Record<GeneralField, string>>;

export const GENERAL_ERRORS = {
  nameEmpty: 'Enter a name.',
  nameLong: 'Use 100 characters or fewer.',
  slugFormat: 'Use lowercase letters, numbers and dashes, with no dash at the start or end.',
  slugTaken: 'This URL is taken. Try another.',
} as const;

/** Only the changed fields (the name without outer spaces); null when nothing changed. */
export function changedFields(initial: GeneralValues, values: GeneralValues): UpdateOrgRequest | null {
  const name = values.name.trim();
  const body: { name?: string; slug?: string } = {};
  if (name !== initial.name) body.name = name;
  if (values.slug !== initial.slug) body.slug = values.slug;
  return body.name === undefined && body.slug === undefined ? null : body;
}

/** The first message per field for the current values, in the form's own wording. */
export function validateGeneral(value: GeneralValues) {
  const result = UpdateOrgRequest.safeParse({ name: value.name.trim(), slug: value.slug });
  if (result.success) return undefined;
  const fields: FieldErrors = {};
  for (const issue of result.error.issues) {
    if (issue.path[0] === 'name')
      fields.name ??= issue.code === 'too_big' ? GENERAL_ERRORS.nameLong : GENERAL_ERRORS.nameEmpty;
    else if (issue.path[0] === 'slug') fields.slug ??= GENERAL_ERRORS.slugFormat;
  }
  return Object.keys(fields).length > 0 ? { fields } : undefined;
}

/** problem+json pointers into the update body. */
export const GENERAL_FIELD_POINTERS = { '/name': 'name', '/slug': 'slug' } as const satisfies Record<
  string,
  GeneralField
>;

export interface GeneralProblem {
  fields: FieldErrors;
  /** The answer named no known field, or more than the fields: the Banner says it. */
  formError?: { title: string; requestId?: string };
}

/** Spreads a failed update over the form: a 409 on `/slug` is "taken"; unmapped answers become the Banner. */
export function generalProblem(e: unknown): GeneralProblem {
  if (isOrgMismatch(e)) return { fields: {}, formError: { title: ORG_SWITCHED_MESSAGE } };
  if (!(e instanceof ApiError) || e.status === 0) return { fields: {}, formError: { title: GENERIC_FORM_ERROR } };
  const fields: FieldErrors = {};
  let unmapped = 0;
  for (const err of e.errors ?? []) {
    const field = Object.entries(GENERAL_FIELD_POINTERS).find(([p]) => p === err.pointer)?.[1];
    if (field === undefined) unmapped += 1;
    else fields[field] ??= field === 'slug' && e.status === 409 ? GENERAL_ERRORS.slugTaken : err.detail;
  }
  if (Object.keys(fields).length > 0 && unmapped === 0) return { fields };
  return { fields, formError: { title: e.title, ...(e.requestId !== undefined && { requestId: e.requestId }) } };
}

function messageOf(errorMap: ValidationErrorMap): string | undefined {
  if (typeof errorMap.onServer === 'string') return errorMap.onServer;
  return Object.values(errorMap).find((v): v is string => typeof v === 'string');
}

/** What a save needs to put back on the form: the saved values and the server's messages. */
export interface GeneralControls {
  reset(next: GeneralValues): void;
  setServerErrors(next: FieldErrors): void;
}

/**
 * The form's values and messages. `onValid` gets the changed fields once the values pass the contract; it never runs
 * for an unchanged form. Server messages are set with `setServerErrors` and cleared by the next change to the field.
 */
export function useGeneralForm(
  org: { id: string; name: string; slug: string },
  onValid: (body: UpdateOrgRequest, controls: GeneralControls) => Promise<void> | void,
) {
  const saved: GeneralValues = { name: org.name, slug: org.slug };
  const form = useForm({
    defaultValues: saved,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => validateGeneral(value) },
    onSubmit: async ({ value }) => {
      const body = changedFields(saved, value);
      if (body !== null) await onValid(UpdateOrgRequest.parse(body), controls);
    },
  });
  const controls: GeneralControls = {
    reset: (next) => form.reset(next),
    setServerErrors(next) {
      for (const name of ['name', 'slug'] as const) {
        const message = next[name];
        if (message !== undefined)
          form.setFieldMeta(name, (prev) => ({ ...prev, errorMap: { ...prev.errorMap, onServer: message } }));
      }
    },
  };
  const fields = { name: useField({ form, name: 'name' }), slug: useField({ form, name: 'slug' }) };
  const saving = useStore(form.store, (s) => s.isSubmitting);

  const values: GeneralValues = { name: fields.name.state.value, slug: fields.slug.state.value };
  const errors: FieldErrors = {};
  for (const name of ['name', 'slug'] as const) {
    const message = messageOf(fields[name].state.meta.errorMap);
    if (message !== undefined) errors[name] = message;
  }

  const clearServerError = (name: GeneralField) => {
    if (fields[name].state.meta.errorMap.onServer !== undefined) fields[name].setErrorMap({ onServer: undefined });
  };

  return {
    values,
    errors,
    saving,
    dirty: changedFields(saved, values) !== null,
    change(name: GeneralField, value: string) {
      clearServerError(name);
      fields[name].handleChange(value);
    },
    submit() {
      if (form.state.isSubmitting) return;
      for (const name of ['name', 'slug'] as const) clearServerError(name);
      void form.handleSubmit();
    },
  };
}
