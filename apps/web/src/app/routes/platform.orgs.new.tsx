import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useToast } from '@/ds';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { useCreateOrgForm } from '@/features/orgs/createOrg';
import { copyText } from '@/features/orgInvitations/link';
import { CreateOrg } from '@/screens';

// The platform admin's create-org form, inside the platform shell. Who may open it is the platform layout's
// `beforeLoad` check (a non-admin gets the forbidden state before this page renders and no create request is sent).
// UI only: the API is the authority.
export const Route = createFileRoute('/platform/orgs/new')({
  component: CreateOrgPage,
});

const COPY_FAILED = 'Could not copy. Select the link and copy it.';

function CreateOrgPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const form = useCreateOrgForm({ onOrgSwitched: () => toast.show({ tone: 'err', title: ORG_SWITCHED_MESSAGE }) });
  const { state } = form;
  return (
    <CreateOrg
      state={state}
      onChange={form.change}
      onSubmit={form.submit}
      onRetry={form.retry}
      onCopy={() => {
        if (state.kind !== 'created') return;
        void copyText(state.link).then((ok) =>
          toast.show(ok ? { tone: 'ok', title: 'Link copied' } : { tone: 'err', title: COPY_FAILED }),
        );
      }}
      onDone={() => {
        if (state.kind !== 'created') return;
        void navigate({ to: '/platform/orgs/$orgId', params: { orgId: state.orgId } });
      }}
    />
  );
}
