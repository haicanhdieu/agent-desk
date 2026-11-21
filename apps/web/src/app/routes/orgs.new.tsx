import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useToast } from '@/ds';
import { sessionAccessQuery } from '@/features/access/queries';
import { ORG_SWITCHED_MESSAGE } from '@/features/auth/orgResync';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { useCreateOrgForm } from '@/features/orgs/createOrg';
import { toOrgSwitch } from '@/features/orgs/orgSwitch';
import { copyText } from '@/features/orgInvitations/link';
import { CreateOrg, type CreateOrgState } from '@/screens';

// The platform admin's create-org form, outside `/o/$org` like the welcome page. The session, memberships and the
// access check are read before render; a person who is not a platform admin gets the forbidden state and no form.
export const Route = createFileRoute('/orgs/new')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(sessionQuery),
      queryClient.ensureQueryData(orgsQuery),
      queryClient.ensureQueryData(sessionAccessQuery),
    ]).then(() => null),
  component: CreateOrgPage,
});

const COPY_FAILED = 'Could not copy. Select the link and copy it.';

function CreateOrgPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: access } = useSuspenseQuery(sessionAccessQuery);
  const toast = useToast();
  const navigate = useNavigate();
  const form = useCreateOrgForm({ onOrgSwitched: () => toast.show({ tone: 'err', title: ORG_SWITCHED_MESSAGE }) });
  const handle = session?.user.handle ?? '';
  const state: CreateOrgState = access.platformAdmin ? form.state : { kind: 'forbidden' };
  return (
    <CreateOrg
      user={{ login: handle, initials: handle.slice(0, 2).toUpperCase() }}
      org={{
        ...toOrgSwitch(orgs, null, access.platformAdmin),
        orgHref: (o: { slug: string }) => `/o/${encodeURIComponent(o.slug)}/projects`,
        createHref: '/orgs/new',
      }}
      state={state}
      onChange={form.change}
      onSubmit={form.submit}
      onRetry={form.retry}
      onCopy={() => {
        if (form.state.kind !== 'created') return;
        void copyText(form.state.link).then((ok) =>
          toast.show(ok ? { tone: 'ok', title: 'Link copied' } : { tone: 'err', title: COPY_FAILED }),
        );
      }}
      onDone={() => void navigate({ to: '/' })}
    />
  );
}
