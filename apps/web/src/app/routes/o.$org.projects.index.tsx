import { useQuery, useQueryClient, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { can } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { createFileRoute, useNavigate, type ErrorComponentProps } from '@tanstack/react-router';
import {
  PageSearch,
  loadPage,
  pageOfSearch,
  pageToSearch,
  usePageSize,
  usePagedQuery,
  usePaginationProps,
  useClampToLastPage,
  readPageSize,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { Forbidden, RouteError } from '@/app/boundaries';
import { TopBar, type OnboardingChecklistState } from '@/components';
import { canInvite, orgAccessQuery, toAccess } from '@/features/access/queries';
import { orgsQuery, sessionQuery } from '@/features/auth/session';
import { myInvitationsQuery } from '@/features/invitations/queries';
import { toOrgSwitch } from '@/features/orgs/orgSwitch';
import { checklistKey, checklistQuery, toChecklistSteps } from '@/features/onboarding/checklist';
import { toConnectionStatus, toProject } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { Projects } from '@/screens';
import type { Actor } from '@/mocks/types';

export const Route = createFileRoute('/o/$org/projects/')({
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: pageOfSearch(search) }),
  loader: ({ context: { queryClient }, params, deps: { page }, cause }) =>
    loadPage(queryClient, projectsQueries.list(params.org, { page, pageSize: readPageSize() }), cause),
  component: ProjectsPage,
  errorComponent: ProjectsError,
});

/** The org switcher's props for the org the URL names: orgs link to their Projects page, "Create organization" to /orgs/new. */
function useOrgSwitchProps(org: string, platformAdmin: boolean) {
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  return {
    ...toOrgSwitch(orgs, org, platformAdmin),
    orgHref: (o: { slug: string }) => `/o/${encodeURIComponent(o.slug)}/projects`,
    createHref: '/orgs/new',
  };
}

// A 403 keeps the global top bar with the switcher over Forbidden, so a member with no role here can switch away.
function ProjectsError(props: ErrorComponentProps) {
  if (!(props.error instanceof ApiError && props.error.status === 403)) return <RouteError {...props} />;
  return <ProjectsForbidden />;
}

function ProjectsForbidden() {
  const { org } = Route.useParams();
  const { data: session } = useSuspenseQuery(sessionQuery);
  // A pending or failed access query leaves the switcher without the platform-admin entry; it still switches.
  const { data: access } = useQuery(orgAccessQuery(org));
  const orgSwitch = useOrgSwitchProps(org, access?.platformAdmin ?? false);
  const handle = session?.user.handle ?? '';
  return (
    <>
      <TopBar variant="global" user={{ login: handle, initials: handle.slice(0, 2).toUpperCase() }} org={orgSwitch} />
      <Forbidden />
    </>
  );
}

/**
 * The first-run checklist card's state: only for org-scope `project:create` holders, nothing once the org is complete.
 * It never suspends or throws: a failure is the card's own error state with Retry, the page stays usable.
 */
function useChecklistState(
  org: string,
  orgId: string | undefined,
  enabled: boolean,
): OnboardingChecklistState | undefined {
  const query = useQuery({ ...checklistQuery(org, orgId ?? ''), enabled: enabled && orgId !== undefined });
  const queryClient = useQueryClient();
  // Data known to be out of date (a step was completed since) is never shown while its refetch runs.
  const stale = query.isFetching && queryClient.getQueryState(checklistKey(org))?.isInvalidated === true;
  if (!enabled) return undefined;
  if (query.isError) {
    const requestId = query.error instanceof ApiError ? query.error.requestId : undefined;
    return { kind: 'error', ...(requestId !== undefined && { requestId }), onRetry: () => void query.refetch() };
  }
  if (query.data === undefined || stale) return { kind: 'loading' };
  if (query.data.complete) return undefined;
  return { kind: 'ready', steps: toChecklistSteps(query.data, org) };
}

function ProjectsPage() {
  const { org } = Route.useParams();
  const page = pageOfSearch(Route.useSearch());
  const navigate = useNavigate({ from: Route.fullPath });
  const now = useNow();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  const access = toAccess(accessDto);
  const orgSwitch = useOrgSwitchProps(org, accessDto.platformAdmin);
  const checklist = useChecklistState(org, orgSwitch.current?.id, can(access, 'project:create'));
  // A failed invitations list hides the banner; it never breaks the page.
  const { data: invitations } = useQuery(myInvitationsQuery);
  const pending = invitations?.total ?? 0;
  const [pageSize] = usePageSize();
  const { data, busy } = usePagedQuery({ page, pageSize }, (q) => projectsQueries.list(org, q));
  const dtos = data.items;
  // One request per project of the shown page, in parallel; the list suspends until all have answered.
  const connections = useSuspenseQueries({
    queries: dtos.map((d) => projectsQueries.connection(org, d.id)),
  });
  const projects = dtos.map((dto, i) => {
    const connection = connections[i];
    if (!connection) throw new Error(`Missing connection query for project ${dto.id}`);
    return toProject(dto, toConnectionStatus(connection.data, dto, now), org, now);
  });
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p) }), replace });
  useClampToLastPage(page, data.pageSize, data.total, (p) => go(p, true));
  const pagination = usePaginationProps({ page: data.page, pageSize: data.pageSize, total: data.total, busy, go });
  const handle = session?.user.handle ?? '';
  const user: Actor = {
    login: handle,
    initials: handle.slice(0, 2).toUpperCase(),
  };
  const orgPath = `/o/${encodeURIComponent(org)}`;
  return (
    <Projects
      user={user}
      projects={projects}
      newHref={`${orgPath}/projects/new/repo`}
      projectHref={(p) => `${orgPath}/p/${encodeURIComponent(p.id)}/runs`}
      settingsHref={(p) => `${orgPath}/p/${encodeURIComponent(p.id)}/desk/agent`}
      switchToPollingHref={(p) => `${orgPath}/p/${encodeURIComponent(p.id)}/desk/agent`}
      pagination={pagination}
      org={orgSwitch}
      {...(pending > 0 && { invitationsBanner: { count: pending, href: '/invitations' } })}
      {...(canInvite(access) && { invitationsHref: `${orgPath}/invitations` })}
      canCreate={can(access, 'project:create')}
      {...(checklist && { checklist })}
    />
  );
}
