import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { can, type UpdateOrgRequest } from '@agentdesk/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { requirePermission } from '@/features/access/guards';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { orgsQuery } from '@/features/auth/session';
import { generalProblem, useGeneralForm, type GeneralControls } from '@/features/orgSettings/general.form';
import { useUpdateOrg } from '@/features/orgSettings/mutations';
import { OrgGeneral, type OrgGeneralProps } from '@/screens';

export const Route = createFileRoute('/o/$org/settings/general')({
  staticData: { chrome: { mode: 'standard', scope: 'org', item: 'general', crumb: 'General' } },
  // General needs `org:update` at org level (a project grant never gives it); the API is the authority.
  beforeLoad: ({ context: { queryClient }, params }) => requirePermission(queryClient, params.org, 'org:update'),
  component: GeneralPage,
});

function GeneralPage() {
  const { org } = Route.useParams();
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  const found = orgs.find((o) => o.slug === org);
  // Right after a URL change the orgs cache holds the new slug while the router still shows the old one (the new
  // route's guard is loading). The form must stay mounted then, or its "Organization updated" toast and state are lost.
  const [lastFound, setLastFound] = useState(found);
  if (found !== undefined && found !== lastFound) setLastFound(found);
  const current = found ?? lastFound;
  // Without `org:update` the page is the no-access state and nothing is sent.
  if (!can(toAccess(accessDto), 'org:update')) return <OrgGeneral {...FORBIDDEN} />;
  if (current === undefined) return null;
  return <GeneralForm key={current.id} org={org} saved={current} />;
}

const noop = () => {};
const FORBIDDEN: OrgGeneralProps = {
  state: { kind: 'forbidden' },
  name: { value: '', onChange: noop },
  slug: { value: '', onChange: noop },
  dirty: false,
  saving: false,
  onSave: noop,
};

function GeneralForm({ org, saved }: { org: string; saved: { id: string; name: string; slug: string } }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useUpdateOrg(org, saved.id);
  const [formError, setFormError] = useState<OrgGeneralProps['formError']>();
  const [confirm, setConfirm] = useState<{ body: UpdateOrgRequest; to: string; controls: GeneralControls }>();
  const [notice, setNotice] = useState(false);

  async function send(body: UpdateOrgRequest, controls: GeneralControls) {
    setFormError(undefined);
    try {
      const result = await update.mutateAsync(body);
      controls.reset({ name: result.name, slug: result.slug });
      setNotice(true);
      if (result.slug !== org) {
        // The orgs cache already holds the new slug, so the router resolves it; the old slug's data is dropped.
        await navigate({ to: '/o/$org/settings/general', params: { org: result.slug }, replace: true });
        queryClient.removeQueries({ queryKey: ['org', org] });
      }
      void queryClient.invalidateQueries({ queryKey: orgsQuery.queryKey });
    } catch (e) {
      const problem = generalProblem(e);
      controls.setServerErrors(problem.fields);
      setFormError(problem.formError);
    }
  }

  const form = useGeneralForm(saved, (body, controls) => {
    if (body.slug !== undefined) setConfirm({ body, to: body.slug, controls });
    else return send(body, controls);
  });

  return (
    <OrgGeneral
      state={{ kind: 'ready' }}
      name={{
        value: form.values.name,
        ...(form.errors.name !== undefined && { error: form.errors.name }),
        onChange: (v) => form.change('name', v),
      }}
      slug={{
        value: form.values.slug,
        ...(form.errors.slug !== undefined && { error: form.errors.slug }),
        onChange: (v) => form.change('slug', v),
      }}
      dirty={form.dirty}
      saving={form.saving || update.isPending}
      {...(formError !== undefined && { formError })}
      onSave={form.submit}
      {...(confirm !== undefined && {
        slugConfirm: {
          from: saved.slug,
          to: confirm.to,
          onConfirm: () => {
            setConfirm(undefined);
            void send(confirm.body, confirm.controls);
          },
          onCancel: () => setConfirm(undefined),
        },
      })}
      {...(notice && {
        notice: { tone: 'ok' as const, title: 'Organization updated', onDismiss: () => setNotice(false) },
      })}
    />
  );
}
