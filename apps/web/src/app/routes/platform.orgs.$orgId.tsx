import { useEffect, useRef, useState } from 'react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { OrgStatusChangeRequest, type OrgStatus, type UpdateOrgRequest } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { revalidateLogic, useField, useForm, useStore } from '@tanstack/react-form';
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useNow } from '@/app/useNow';
import { EditOrgDialog, SlugChangeConfirm, type SuspendOrgDialogProps } from '@/components';
import { useToast } from '@/ds';
import { openOrgHref } from '@/features/chrome/appBar';
import { orgsQuery } from '@/features/auth/session';
import { fieldErrorsFromProblem } from '@/features/desk/problem';
import { generalProblem, useGeneralForm, type GeneralControls } from '@/features/orgSettings/general.form';
import { toPlatformOrgOverview } from '@/features/platform/map';
import { useSetOrgStatus, useUpdatePlatformOrg } from '@/features/platform/mutations';
import { platformOrgQuery } from '@/features/platform/queries';
import { PlatformOrgDetail, type PlatformOrgDetailProps } from '@/screens';

// One organization in the platform area: the header, the suspended Banner and the Suspend and Reactivate dialog live
// here, so every page below (Overview now, more later) shows them. A 403 from the read (rights lost since) shows the
// shell's forbidden state. UI only: the API is the authority.
export const Route = createFileRoute('/platform/orgs/$orgId')({
  component: PlatformOrgLayout,
});

const REASON_REQUIRED = 'Enter a reason.';
const REASON_TOO_LONG = 'Use 500 characters or fewer.';

function validateReason(reason: string) {
  const result = OrgStatusChangeRequest.safeParse({ reason });
  if (result.success) return undefined;
  const tooLong = result.error.issues.some((i) => i.code === 'too_big');
  return { fields: { reason: tooLong ? REASON_TOO_LONG : REASON_REQUIRED } };
}

/** The suspend and reactivate dialog's form: validated with the contract's request, server answers land at Reason or in a Banner. */
function useStatusForm(
  orgId: string,
  mode: OrgStatus | null,
  onDone: (to: OrgStatus) => void,
  onGone: () => void,
  onClose: () => void,
) {
  const set = useSetOrgStatus(orgId);
  const [formError, setFormError] = useState<SuspendOrgDialogProps['formError']>();
  const form = useForm({
    defaultValues: { reason: '' },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: ({ value }) => validateReason(value.reason) },
    onSubmit: async ({ value, formApi }) => {
      if (mode === null) return;
      const onReason = (message: string) =>
        formApi.setFieldMeta('reason', (prev) => ({ ...prev, errorMap: { ...prev.errorMap, onServer: message } }));
      const info = (e: ApiError) => ({ title: e.title, ...(e.requestId !== undefined && { requestId: e.requestId }) });
      try {
        await set.mutateAsync({ to: mode, reason: OrgStatusChangeRequest.parse(value).reason });
        onDone(mode);
      } catch (e) {
        // The reason stays as typed; only the messages change.
        if (e instanceof ApiError && e.status === 404) onGone();
        else if (e instanceof ApiError && e.status === 400) {
          const problem = fieldErrorsFromProblem(e, { '/reason': 'reason' });
          if (problem.fields.reason !== undefined) onReason(problem.fields.reason);
          else setFormError(info(e));
        } else if (e instanceof ApiError) setFormError(info(e));
        else setFormError({ title: 'Something went wrong. Try again.' });
      }
    },
  });
  const field = useField({ form, name: 'reason' });
  const saving = useStore(form.store, (s) => s.isSubmitting);
  const map = field.state.meta.errorMap;
  const error = typeof map.onServer === 'string' ? map.onServer : Object.values(map).find((v) => typeof v === 'string');
  const clearServer = () => {
    if (map.onServer !== undefined) field.setErrorMap({ onServer: undefined });
    setFormError(undefined);
  };
  return {
    reason: field.state.value,
    error: typeof error === 'string' ? error : undefined,
    formError,
    saving,
    onReason: (r: string) => {
      clearServer();
      field.handleChange(r);
    },
    onSubmit: () => {
      if (form.state.isSubmitting || set.isPending) return;
      clearServer();
      void form.handleSubmit();
    },
    // Each opening starts from an empty form.
    reset: () => {
      form.reset();
      setFormError(undefined);
    },
    onClose,
  };
}

/**
 * The Edit organization dialog and the URL-change confirm. Mounted per opening, so each opening starts from the saved
 * values. A slug change asks first; the answer's messages land at the field or in the Banner.
 */
function EditOrgModals({
  org,
  onDone,
  onGone,
  onClose,
}: {
  org: { id: string; name: string; slug: string };
  onDone: () => void;
  onGone: () => void;
  onClose: () => void;
}) {
  const update = useUpdatePlatformOrg(org.id);
  const [formError, setFormError] = useState<{ title: string; requestId?: string }>();
  const [confirm, setConfirm] = useState<{ body: UpdateOrgRequest; to: string; controls: GeneralControls }>();

  async function send(body: UpdateOrgRequest, controls: GeneralControls) {
    setFormError(undefined);
    try {
      await update.mutateAsync(body);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        onGone();
        return;
      }
      const problem = generalProblem(e);
      controls.setServerErrors(problem.fields);
      setFormError(problem.formError);
    }
  }

  const form = useGeneralForm(org, (body, controls) => {
    if (body.slug !== undefined) setConfirm({ body, to: body.slug, controls });
    else return send(body, controls);
  });

  // The first field with a message takes the focus (the dialog sits in a portal, so look it up in the document).
  const { name: nameError, slug: slugError } = form.errors;
  useEffect(() => {
    if (nameError || slugError) {
      document.querySelector<HTMLInputElement>('[role="dialog"] input[aria-invalid="true"]')?.focus();
    }
  }, [nameError, slugError]);

  if (confirm !== undefined) {
    return (
      <SlugChangeConfirm
        from={org.slug}
        to={confirm.to}
        closing="Share the new link with its members."
        busy={update.isPending}
        onConfirm={() => {
          const { body, controls } = confirm;
          setConfirm(undefined);
          void send(body, controls);
        }}
        onCancel={() => setConfirm(undefined)}
      />
    );
  }
  return (
    <EditOrgDialog
      open
      values={form.values}
      errors={form.errors}
      dirty={form.dirty}
      saving={form.saving || update.isPending}
      {...(formError !== undefined && { formError })}
      onChange={(v) => {
        if (v.name !== form.values.name) form.change('name', v.name);
        if (v.slug !== form.values.slug) form.change('slug', v.slug);
      }}
      onSubmit={form.submit}
      onClose={onClose}
    />
  );
}

function PlatformOrgLayout() {
  const { orgId } = Route.useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow();
  const [mode, setMode] = useState<OrgStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const focusEdit = useRef(false);
  const focusHeading = useRef(false);
  const detail = useQuery(platformOrgQuery(orgId));
  const { data: memberships } = useSuspenseQuery(orgsQuery);
  const openHref = openOrgHref(memberships, orgId);

  const form = useStatusForm(
    orgId,
    mode,
    (to) => {
      focusHeading.current = true;
      setMode(null);
      toast.show({ tone: 'ok', title: to === 'suspended' ? 'Organization suspended' : 'Organization reactivated' });
    },
    () => {
      setMode(null);
      toast.show({ tone: 'err', title: 'Organization not found' });
      void navigate({ to: '/platform/orgs' });
    },
    () => setMode(null),
  );
  const { reset } = form;
  const open = (to: OrgStatus) => {
    reset();
    setMode(to);
  };

  // After the dialog leaves, focus moves to the page heading: the opener is gone or has changed.
  useEffect(() => {
    if (mode !== null || !focusHeading.current) return;
    focusHeading.current = false;
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [mode]);

  // After the edit dialog leaves, focus returns to "Edit organization".
  useEffect(() => {
    if (editing || !focusEdit.current) return;
    focusEdit.current = false;
    [...document.querySelectorAll<HTMLElement>('main button')]
      .find((b) => b.textContent === 'Edit organization')
      ?.focus();
  }, [editing]);

  const data = detail.data;
  let view: PlatformOrgDetailProps['view'];
  if (detail.error instanceof ApiError && detail.error.status === 403) {
    throw detail.error;
  } else if (detail.error instanceof ApiError && detail.error.status === 404) {
    view = { kind: 'notFound', backHref: '/platform/orgs' };
  } else if (detail.isError) {
    const failure = detail.error;
    view = {
      kind: 'error',
      title: failure instanceof ApiError ? failure.title : 'Something went wrong',
      ...(failure instanceof ApiError && failure.requestId !== undefined && { requestId: failure.requestId }),
      onRetry: () => void detail.refetch(),
    };
  } else if (data === undefined) {
    view = { kind: 'loading' };
  } else {
    view = {
      kind: 'ready',
      header: {
        name: data.name,
        slug: data.slug,
        status: data.status,
        auditHref: `/platform/audit?org=${encodeURIComponent(data.id)}`,
        ...(openHref !== undefined && { openHref }),
        onEdit: () => setEditing(true),
        onSuspend: () => open('suspended'),
        onReactivate: () => open('active'),
      },
      overview: toPlatformOrgOverview(data, now),
    };
  }

  return (
    <PlatformOrgDetail
      view={view}
      children={<Outlet />}
      {...(editing &&
        data !== undefined && {
          editSlot: (
            <EditOrgModals
              org={data}
              onDone={() => {
                focusEdit.current = true;
                setEditing(false);
                toast.show({ tone: 'ok', title: 'Organization updated' });
              }}
              onGone={() => {
                setEditing(false);
                toast.show({ tone: 'err', title: 'Organization not found' });
                void navigate({ to: '/platform/orgs' });
              }}
              onClose={() => {
                focusEdit.current = true;
                setEditing(false);
              }}
            />
          ),
        })}
      {...(mode !== null &&
        data !== undefined && {
          dialog: {
            mode: mode === 'suspended' ? 'suspend' : 'reactivate',
            orgName: data.name,
            open: true,
            reason: form.reason,
            ...(form.error !== undefined && { error: form.error }),
            ...(form.formError && { formError: form.formError }),
            saving: form.saving,
            onReason: form.onReason,
            onSubmit: form.onSubmit,
            onClose: form.onClose,
          },
        })}
    />
  );
}
