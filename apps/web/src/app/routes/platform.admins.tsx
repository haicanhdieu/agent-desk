import { useEffect, useRef, useState } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { GrantPlatformAdminRequest } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { revalidateLogic, useField, useForm, useStore, type ValidationErrorMap } from '@tanstack/react-form';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  pageOfSearch,
  pageToSearch,
  useClampToLastPage,
  usePageSize,
  usePaginationProps,
  PageSearch,
} from '@/app/pagination';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import type { AddPlatformAdminDialogProps } from '@/components';
import { useToast } from '@/ds';
import { fieldErrorsFromProblem } from '@/features/desk/problem';
import { sessionQuery } from '@/features/auth/session';
import { toPlatformAdminRow } from '@/features/platform/map';
import { useGrantPlatformAdmin, useRevokePlatformAdmin } from '@/features/platform/mutations';
import { platformAdminsQuery } from '@/features/platform/queries';
import type { PlatformAdminRowView } from '@/mocks';
import { PlatformAdmins, type PlatformAdminsProps } from '@/screens';

// Who may open the platform area. The shell has already refused anyone who is not a platform admin; a 403 from the
// list (rights lost since) shows the same forbidden state. UI only: the API is the authority.
export const Route = createFileRoute('/platform/admins')({
  validateSearch: PageSearch,
  component: PlatformAdminsPage,
});

const EMAIL_INVALID = 'Enter a valid email address.';
const EMAIL_TOO_LONG = 'Use 254 characters or fewer.';
const NO_ACCOUNT = 'No account has this email yet.';
const NOT_VERIFIED = 'This email is not verified yet.';

function validateEmail(email: string) {
  const result = GrantPlatformAdminRequest.safeParse({ email });
  if (result.success) return undefined;
  const tooLong = result.error.issues.some((i) => i.code === 'too_big');
  return { fields: { email: tooLong ? EMAIL_TOO_LONG : EMAIL_INVALID } };
}

const messageOf = (errorMap: ValidationErrorMap): string | undefined => {
  if (typeof errorMap.onServer === 'string') return errorMap.onServer;
  return Object.values(errorMap).find((v): v is string => typeof v === 'string');
};

/** The Add dialog's form: validated with the contract's request, server answers land under Email or in a Banner. */
function useGrantForm(
  open: boolean,
  onDone: () => void,
  onClose: () => void,
): { dialog: AddPlatformAdminDialogProps; reset: () => void } {
  const grant = useGrantPlatformAdmin();
  const [formError, setFormError] = useState<AddPlatformAdminDialogProps['formError']>();
  const form = useForm({
    defaultValues: { email: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => validateEmail(value.email) },
    onSubmit: async ({ value, formApi }) => {
      const onEmail = (message: string) =>
        formApi.setFieldMeta('email', (prev) => ({ ...prev, errorMap: { ...prev.errorMap, onServer: message } }));
      try {
        await grant.mutateAsync(GrantPlatformAdminRequest.parse(value));
        onDone();
      } catch (e) {
        // The input stays as typed; only the messages change.
        if (e instanceof ApiError && e.status === 404) onEmail(NO_ACCOUNT);
        else if (e instanceof ApiError && e.status === 422) onEmail(NOT_VERIFIED);
        else if (e instanceof ApiError && e.status === 400) {
          const problem = fieldErrorsFromProblem(e, { '/email': 'email' });
          if (problem.fields.email !== undefined) onEmail(problem.fields.email);
          else setFormError({ title: e.title, ...(e.requestId !== undefined && { requestId: e.requestId }) });
        } else if (e instanceof ApiError) {
          setFormError({ title: e.title, ...(e.requestId !== undefined && { requestId: e.requestId }) });
        } else {
          setFormError({ title: 'Something went wrong. Try again.' });
        }
      }
    },
  });
  const email = useField({ form, name: 'email' });
  const saving = useStore(form.store, (s) => s.isSubmitting);
  const error = messageOf(email.state.meta.errorMap);
  const dialog: AddPlatformAdminDialogProps = {
    open,
    values: { email: email.state.value },
    errors: error === undefined ? {} : { email: error },
    saving,
    ...(formError && { formError }),
    onChange: (v) => {
      if (email.state.meta.errorMap.onServer !== undefined) email.setErrorMap({ onServer: undefined });
      setFormError(undefined);
      email.handleChange(v.email);
    },
    onSubmit: () => {
      if (form.state.isSubmitting) return;
      if (email.state.meta.errorMap.onServer !== undefined) email.setErrorMap({ onServer: undefined });
      setFormError(undefined);
      void form.handleSubmit();
    },
    onClose,
  };
  // Each opening starts from an empty form.
  const reset = () => {
    form.reset();
    setFormError(undefined);
  };
  return { dialog, reset };
}

function PlatformAdminsPage() {
  const search = Route.useSearch();
  const page = pageOfSearch(search);
  const navigate = useNavigate({ from: Route.fullPath });
  const [pageSize] = usePageSize();
  const toast = useToast();
  const now = useNow();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const sessionUserId = session?.user.id ?? '';

  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<PlatformAdminRowView | null>(null);
  const focusHeading = useRef(false);
  const revoke = useRevokePlatformAdmin();
  const add = useGrantForm(
    adding,
    () => {
      setAdding(false);
      toast.show({ tone: 'ok', title: 'Platform admin added' });
    },
    () => setAdding(false),
  );

  // After a revoke the opener is gone: focus moves to the page heading, once the confirm has left the page.
  useEffect(() => {
    if (revoking !== null || !focusHeading.current) return;
    focusHeading.current = false;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [revoking]);

  const list = useQuery(platformAdminsQuery({ page, pageSize }));
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  const data = list.data;
  useClampToLastPage(page, data?.pageSize ?? pageSize, data?.total ?? 0, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: data?.page ?? page,
    pageSize: data?.pageSize ?? pageSize,
    total: data?.total ?? 0,
    busy: list.isPlaceholderData,
    go,
  });

  let view: PlatformAdminsProps['view'];
  if (list.error instanceof ApiError && list.error.status === 403) {
    view = { kind: 'forbidden' };
  } else if (list.isError) {
    const failure = list.error;
    view = {
      kind: 'error',
      title: failure instanceof ApiError ? failure.title : 'Something went wrong',
      ...(failure instanceof ApiError && failure.requestId !== undefined && { requestId: failure.requestId }),
      onRetry: () => void list.refetch(),
    };
  } else if (data === undefined) {
    view = { kind: 'loading' };
  } else {
    view = {
      kind: 'ready',
      rows: data.items.map((dto) => toPlatformAdminRow(dto, sessionUserId, now)),
      pagination,
      ...(revoke.isPending && { busyId: revoke.variables.adminId }),
    };
  }

  const onConfirmRevoke = async () => {
    if (revoking === null || revoke.isPending) return;
    const row = revoking;
    try {
      await revoke.mutateAsync({ adminId: row.id, own: row.you });
      toast.show({ tone: 'ok', title: 'Platform admin revoked' });
      if (row.you) {
        setRevoking(null);
        void navigate({ to: '/' });
        return;
      }
      focusHeading.current = true;
      setRevoking(null);
    } catch (e) {
      toast.show(toastFromError(e));
      setRevoking(null); // the list was fetched again for a 404 or 409
    }
  };

  return (
    <PlatformAdmins
      view={view}
      onAdd={() => {
        add.reset();
        setAdding(true);
      }}
      addDialog={add.dialog}
      onRevoke={setRevoking}
      {...(revoking && {
        revokeConfirm: {
          row: revoking,
          own: revoking.you,
          busy: revoke.isPending,
          onConfirm: () => void onConfirmRevoke(),
          onCancel: () => {
            if (!revoke.isPending) setRevoking(null);
          },
        },
      })}
    />
  );
}
