import { CreateInvitationRequest, CreateOrgRequest, slugFromName } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { revalidateLogic, useField, useForm, type ValidationErrorMap } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { CreateOrgState, CreateOrgValues } from '@/screens';
import { api } from '../api';
import { isOrgMismatch } from '../auth/orgResync';
import { orgsQuery } from '../auth/session';
import { GENERIC_FORM_ERROR } from '../desk/problem';
import { formatShortDate } from '../invitations/dates';
import { invitationUrl } from '../orgInvitations/link';
import { platformKeys } from '../platform/keys';
import { refreshAudit } from '../platform/mutations';

// The platform admin's create-org form (spec BR-35, BR-36, BR-39): TanStack Form validated with the contract's
// CreateOrgRequest and invitation email, then two calls in sequence (org create, owner invitation create). The org
// id from the first is kept, so Retry sends only the invitation.

export type CreateOrgField = 'name' | 'slug' | 'email';
type FieldErrors = Partial<Record<CreateOrgField, string>>;

const NAME_REQUIRED = 'Enter a name.';
const NAME_TOO_LONG = 'Use 100 characters or fewer.';
const SLUG_FORMAT = 'Use lowercase letters, numbers and dashes, with no dash at the start or end.';
const SLUG_TAKEN = 'This URL is taken. Try another.';
const EMAIL_INVALID = 'Enter a valid email address.';
const EMAIL_TOO_LONG = 'Use 254 characters or fewer.';
const OWNER_ROLE_KEY = 'owner';

/** problem+json pointers into the create bodies (the org's name and slug, the invitation's email). */
export const CREATE_ORG_FIELD_POINTERS = {
  '/name': 'name',
  '/slug': 'slug',
  '/email': 'email',
} as const satisfies Record<string, CreateOrgField>;

/**
 * The URL after a change: filled from the name (contracts `slugFromName`) until the user edits it; clearing the URL
 * resumes the fill. An empty name leaves an empty URL.
 */
export function nextSlug(
  prev: { name: string; slug: string; edited: boolean },
  change: { name?: string; slug?: string },
): { slug: string; edited: boolean } {
  const name = change.name ?? prev.name;
  const fromName = () => ({ slug: name === '' ? '' : slugFromName(name), edited: false });
  if (change.slug !== undefined) return change.slug === '' ? fromName() : { slug: change.slug, edited: true };
  return prev.edited ? { slug: prev.slug, edited: true } : fromName();
}

function emailError(email: string): string | undefined {
  const result = CreateInvitationRequest.shape.email.safeParse(email.trim());
  if (result.success) return undefined;
  return result.error.issues.some((i) => i.code === 'too_big') ? EMAIL_TOO_LONG : EMAIL_INVALID;
}

/** The first message per field for the current values, in the form's own wording. */
export function validateCreateOrg(value: CreateOrgValues) {
  const fields: FieldErrors = {};
  const result = CreateOrgRequest.safeParse({ name: value.name.trim(), slug: value.slug });
  if (!result.success) {
    for (const issue of result.error.issues) {
      if (issue.path[0] === 'name') fields.name ??= issue.code === 'too_big' ? NAME_TOO_LONG : NAME_REQUIRED;
      else if (issue.path[0] === 'slug') fields.slug ??= SLUG_FORMAT;
    }
  }
  const email = emailError(value.email);
  if (email !== undefined) fields.email = email;
  return Object.keys(fields).length > 0 ? { fields } : undefined;
}

interface Problem {
  fields: FieldErrors;
  title: string;
  requestId?: string;
  /** The answer named a field the form does not know, or none: the Banner says it. */
  banner: boolean;
  /** The tab's org was switched elsewhere: a Toast, not a form message (T12). */
  orgSwitched?: true;
}

function problemOf(e: unknown): Problem {
  if (isOrgMismatch(e)) return { fields: {}, title: GENERIC_FORM_ERROR, banner: false, orgSwitched: true };
  if (!(e instanceof ApiError) || e.status === 0) return { fields: {}, title: GENERIC_FORM_ERROR, banner: true };
  const fields: FieldErrors = {};
  let unmapped = 0;
  for (const err of e.errors ?? []) {
    const field = Object.entries(CREATE_ORG_FIELD_POINTERS).find(([p]) => p === err.pointer)?.[1];
    if (field === undefined) unmapped += 1;
    else fields[field] ??= field === 'slug' && e.status === 409 ? SLUG_TAKEN : err.detail;
  }
  return {
    fields,
    title: e.title,
    ...(e.requestId !== undefined && { requestId: e.requestId }),
    banner: Object.keys(fields).length === 0 || unmapped > 0,
  };
}

const DEFAULT_VALUES: CreateOrgValues = { name: '', slug: '', email: '' };

export interface CreateOrgOptions {
  /** An org-switch failure: the route shows the Toast. */
  onOrgSwitched(): void;
}

type FlowState =
  | { kind: 'form'; errors: FieldErrors; formError?: { title: string; requestId?: string }; saving: boolean }
  | { kind: 'invitationFailed'; errors: Pick<FieldErrors, 'email'>; title: string; retrying: boolean }
  | { kind: 'created'; orgId: string; email: string; expiresOn: string; link: string };

/** Creates the org, then its owner invitation. The state is what the screen shows; `retry` repeats only the invitation. */
export function useCreateOrgWithOwner({ onOrgSwitched }: CreateOrgOptions) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<FlowState>({ kind: 'form', errors: {}, saving: false });
  const orgId = useRef<string | null>(null);
  const busy = useRef(false);

  async function invite(id: string, email: string): Promise<void> {
    try {
      const roles = await api.platform.listRoles({ params: { orgId: id } });
      const owner = roles.find((r) => r.key === OWNER_ROLE_KEY);
      if (!owner) throw new Error('The owner role is missing');
      const body = CreateInvitationRequest.parse({ email: email.trim(), roleId: owner.id, scope: { type: 'org' } });
      const invitation = await api.platform.createInvitation({ params: { orgId: id }, body });
      void refreshAudit(queryClient);
      setState({
        kind: 'created',
        orgId: id,
        email: invitation.email,
        expiresOn: formatShortDate(invitation.expiresAt),
        link: invitationUrl(invitation.id),
      });
    } catch (e) {
      const p = problemOf(e);
      setState({
        kind: 'invitationFailed',
        errors: p.fields.email === undefined ? {} : { email: p.fields.email },
        title: p.title,
        retrying: false,
      });
      if (p.orgSwitched) onOrgSwitched();
    }
  }

  return {
    state,
    async submit(values: CreateOrgValues): Promise<void> {
      if (busy.current || state.kind !== 'form') return;
      busy.current = true;
      setState({ kind: 'form', errors: {}, saving: true });
      try {
        let id = orgId.current;
        if (id === null) {
          try {
            const body = CreateOrgRequest.parse({ name: values.name.trim(), slug: values.slug });
            id = (await api.platform.createOrg({ body })).id;
            orgId.current = id;
            void queryClient.invalidateQueries({ queryKey: orgsQuery.queryKey });
            void queryClient.invalidateQueries({ queryKey: platformKeys.orgsAll() });
            void refreshAudit(queryClient);
          } catch (e) {
            const p = problemOf(e);
            setState({
              kind: 'form',
              errors: p.fields,
              ...(p.banner &&
                !p.orgSwitched && { formError: { title: p.title, ...(p.requestId && { requestId: p.requestId }) } }),
              saving: false,
            });
            if (p.orgSwitched) onOrgSwitched();
            return;
          }
        }
        await invite(id, values.email);
      } finally {
        busy.current = false;
      }
    },
    async retry(email: string): Promise<void> {
      const id = orgId.current;
      if (busy.current || state.kind !== 'invitationFailed' || id === null) return;
      const invalid = emailError(email);
      if (invalid !== undefined) {
        setState({ ...state, errors: { email: invalid } });
        return;
      }
      busy.current = true;
      setState({ ...state, errors: {}, retrying: true });
      try {
        await invite(id, email);
      } finally {
        busy.current = false;
      }
    },
    /** A changed field drops its server message; any change in the form drops its Banner. */
    dismiss(field: CreateOrgField): void {
      setState((prev) => {
        if (prev.kind === 'form') {
          const errors = { ...prev.errors };
          delete errors[field];
          return { kind: 'form', errors, saving: prev.saving };
        }
        if (prev.kind === 'invitationFailed' && field === 'email') return { ...prev, errors: {} };
        return prev;
      });
    },
  };
}

function messageOf(errorMap: ValidationErrorMap): string | undefined {
  return Object.values(errorMap).find((v): v is string => typeof v === 'string');
}

/** The screen's state and handlers: the three fields, the URL fill, and the two-step create behind them. */
export function useCreateOrgForm(options: CreateOrgOptions) {
  const flow = useCreateOrgWithOwner(options);
  const [edited, setEdited] = useState(false);
  const form = useForm({
    defaultValues: DEFAULT_VALUES,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => validateCreateOrg(value) },
    onSubmit: ({ value }) => flow.submit(value),
  });
  const fields = {
    name: useField({ form, name: 'name' }),
    slug: useField({ form, name: 'slug' }),
    email: useField({ form, name: 'email' }),
  };
  const values: CreateOrgValues = {
    name: fields.name.state.value,
    slug: fields.slug.state.value,
    email: fields.email.state.value,
  };
  const clientErrors: FieldErrors = {};
  for (const name of ['name', 'slug', 'email'] as const) {
    const message = messageOf(fields[name].state.meta.errorMap);
    if (message !== undefined) clientErrors[name] = message;
  }

  const s = flow.state;
  let screen: CreateOrgState;
  if (s.kind === 'created') screen = s;
  else if (s.kind === 'invitationFailed') {
    const email = s.errors.email ?? clientErrors.email;
    screen = {
      kind: 'invitationFailed',
      values,
      errors: email === undefined ? {} : { email },
      title: s.title,
      retrying: s.retrying,
    };
  } else
    screen = {
      kind: 'form',
      values,
      errors: { ...clientErrors, ...s.errors },
      ...(s.formError && { formError: s.formError }),
      saving: s.saving,
    };

  return {
    state: screen,
    change(next: CreateOrgValues) {
      const change = {
        ...(next.name !== values.name && { name: next.name }),
        ...(next.slug !== values.slug && { slug: next.slug }),
      };
      const result = nextSlug({ ...values, edited }, change);
      setEdited(result.edited);
      if (next.name !== values.name) {
        flow.dismiss('name');
        fields.name.handleChange(next.name);
      }
      if (result.slug !== values.slug) {
        flow.dismiss('slug');
        fields.slug.handleChange(result.slug);
      }
      if (next.email !== values.email) {
        flow.dismiss('email');
        fields.email.handleChange(next.email);
      }
    },
    submit: () => void form.handleSubmit(),
    retry: () => void flow.retry(values.email),
  };
}
