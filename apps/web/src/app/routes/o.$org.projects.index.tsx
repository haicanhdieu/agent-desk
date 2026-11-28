import { useQuery, useQueryClient, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { can } from '@agentdesk/contracts';
import { ApiError } from '@agentdesk/contracts/client';
import { useRef } from 'react';
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
import { Forbidden, RouteError, toastFromError } from '@/app/boundaries';
import type { OnboardingChecklistState } from '@/components';
import { useToast } from '@/ds';
import { forgetProject, useDeleteProject } from '@/features/desk/mutations';
import { orgAccessQuery, toAccess } from '@/features/access/queries';
import { orgsQuery } from '@/features/auth/session';
import { myInvitationsQuery } from '@/features/invitations/queries';
import { checklistKey, checklistQuery, toChecklistSteps } from '@/features/onboarding/checklist';
import { toConnectionStatus, toProject } from '@/features/projects/map';
import { projectsQueries } from '@/features/projects/queries';
import { Projects } from '@/screens';

export const Route = createFileRoute('/o/$org/projects/')({
  staticData: { chrome: { mode: 'standard', scope: 'org', item: 'projects', crumb: 'Projects' } },
  validateSearch: PageSearch,
  loaderDeps: ({ search }) => ({ page: pageOfSearch(search) }),
  loader: ({ context: { queryClient }, params, deps: { page }, cause }) =>
    loadPage(queryClient, projectsQueries.list(params.org, { page, pageSize: readPageSize() }), cause),
  component: ProjectsPage,
  errorComponent: ProjectsError,
});

// A 403 reports `forbidden` to the shell, which keeps the bar and the org menu, so a member with no role here can switch away.
function ProjectsError(props: ErrorComponentProps) {
  if (!(props.error instanceof ApiError && props.error.status === 403)) return <RouteError {...props} />;
  return <Forbidden />;
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
  const { data: orgs } = useSuspenseQuery(orgsQuery);
  const { data: accessDto } = useSuspenseQuery(orgAccessQuery(org));
  const access = toAccess(accessDto);
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useDeleteProject(org);
  // Delete project is org-level (project:delete): a project-scoped admin, member or viewer gets no menu item, and the API refuses it anyway.
  const mayDelete = can(access, 'project:delete');
  // One request per project while its delete is in flight (a second confirm on the still-listed row is ignored).
  const deleting = useRef(new Set<string>());
  const onDeleteProject = async (p: { id: string }) => {
    if (deleting.current.has(p.id)) return;
    deleting.current.add(p.id);
    try {
      // mutateAsync, not per-call mutate callbacks: the shared observer drops those when a second delete starts.
      await remove.mutateAsync(p.id);
      forgetProject(qc, org, p.id);
    } catch (e) {
      toast.show(toastFromError(e));
    } finally {
      deleting.current.delete(p.id);
    }
  };
  const checklist = useChecklistState(org, orgs.find((o) => o.slug === org)?.id, can(access, 'project:create'));
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
  const orgPath = `/o/${encodeURIComponent(org)}`;
  const settingsHref = (id: string): string | undefined =>
    can(access, 'agent:read', { projectId: id }) ? `${orgPath}/p/${encodeURIComponent(id)}/desk/agent` : undefined;
  const mayResume = can(access, 'project:create');
  const setupSteps = new Map(dtos.map((d) => [d.id, d.setupStep]));
  const resumeHref = (id: string): string | undefined => {
    const step = setupSteps.get(id);
    return mayResume && step !== undefined && step !== 'ready'
      ? `${orgPath}/projects/new/${step}?project=${encodeURIComponent(id)}`
      : undefined;
  };
  return (
    <Projects
      projects={projects}
      newHref={`${orgPath}/projects/new/repo`}
      projectHref={(p) => `${orgPath}/p/${encodeURIComponent(p.id)}/runs`}
      // Project settings is the Desk agent page: only for roles that may read it on that project.
      settingsHref={(p) => settingsHref(p.id)}
      resumeHref={(p) => resumeHref(p.id)}
      switchToPollingHref={(p) => {
        const href = settingsHref(p.id);
        return href === undefined ? undefined : `${href}?tab=github`;
      }}
      pagination={pagination}
      {...(pending > 0 && { invitationsBanner: { count: pending, href: '/invitations' } })}
      canCreate={can(access, 'project:create')}
      // Errors are handled inside onDeleteProject (toast), so the returned promise never rejects.
      {...(mayDelete && { onDeleteProject: (p) => void onDeleteProject(p) })}
      {...(checklist && { checklist })}
    />
  );
}
