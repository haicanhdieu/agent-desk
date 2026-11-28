import { ApiError } from '@agentdesk/contracts/client';
import { useQuery, useQueryErrorResetBoundary } from '@tanstack/react-query';
import { useRouter, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import {
  EmptyState,
  RouteLoadError,
  RouteSkeleton,
  useGoToProjectsHref,
  useReportPageState,
  type ShellPageState,
} from '@/components';
import { Button, type ToastInput } from '@/ds';
import { ORG_SWITCHED_MESSAGE, isOrgMismatch } from '@/features/auth/orgResync';
import { isOrgSuspendedError } from '@/features/auth/orgSuspended';
import { orgsQuery } from '@/features/auth/session';
import { signOutAndRedirect } from '@/features/auth/signOut';
import { OrgSuspended } from '@/screens';
import styles from './boundaries.module.css';

// Error, not-found and pending UI for routes (spec §6). Route `errorComponent`s go through `RouteError`, which
// picks the state from the error: 401 → the sign-out path, 404 → NotFound, 403 → Forbidden, 5xx / network →
// LoaderErrorBanner, anything else → RootErrorBoundary.

/** Org slug of the current location, when inside `/o/$org/...`. */
function useOrgSlug(): string | undefined {
  return useRouterState({ select: (s) => /^\/o\/([^/]+)/.exec(s.location.pathname)?.[1] });
}

function ProjectsLink() {
  const org = useOrgSlug();
  // The shell knows the org whose menu it shows; never lead back to an org the person is not in.
  const href = useGoToProjectsHref() ?? (org ? `/o/${org}/projects` : '/');
  return (
    <Button href={href} variant="primary">
      Go to projects
    </Button>
  );
}

/** The one `main` of an error, forbidden, suspended or loading page; it tells the shell what the page shows. */
function StatePage({
  state,
  centered = false,
  children,
}: {
  state: ShellPageState;
  centered?: boolean;
  children: ReactNode;
}) {
  useReportPageState(state);
  return <main className={centered ? `${styles.main} ${styles.centered}` : styles.main}>{children}</main>;
}

export function NotFound() {
  return (
    <StatePage state="notFound" centered>
      <EmptyState
        title="Page not found"
        headingLevel={1}
        body="This page does not exist, or it belongs to an organization you are not in."
        action={<ProjectsLink />}
      />
    </StatePage>
  );
}

export function Forbidden() {
  return (
    <StatePage state="forbidden" centered>
      <EmptyState
        title="You don't have access"
        headingLevel={1}
        body="Ask an owner of this organization to give you access."
        action={<ProjectsLink />}
      />
    </StatePage>
  );
}

/**
 * The platform area for someone who is not a platform admin and no platform data. It reports "forbidden" and draws
 * only the page: the shell owns the bar and, for a non-admin, shows no menu.
 */
export function PlatformForbidden() {
  return (
    <StatePage state="forbidden" centered>
      <EmptyState
        title="You don't have access"
        headingLevel={1}
        body="This area is for platform admins."
        action={
          <Button href="/projects" variant="primary">
            Go to projects
          </Button>
        }
      />
    </StatePage>
  );
}

/**
 * A member's view of a suspended org: the fixed message in the page's one main. The shell draws the bar (switcher
 * included when there is something to choose, so they can leave) from the session-wide data only, never the refused
 * org-scoped access, and nothing of the org is loaded.
 */
export function SuspendedOrgPage() {
  const slug = useOrgSlug();
  const orgs = useQuery(orgsQuery).data;
  const name = orgs?.find((o) => o.slug === slug)?.name ?? 'this organization';
  useReportPageState('suspended');
  return <OrgSuspended orgName={name} />;
}

/** Full-page fallback for crashes. Shows the request id so a bug report can be matched to server logs. */
export function RootErrorBoundary({ error }: { error: unknown }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className={styles.page}>
      <EmptyState
        title="Something went wrong"
        body="An unexpected error stopped this page. Reload to try again."
        action={
          <Button icon="refresh" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      >
        {requestId && (
          <p className={styles.requestId}>
            Request ID: <code>{requestId}</code>
          </p>
        )}
      </EmptyState>
    </div>
  );
}

/** A 5xx or network failure while loading: the problem title and detail with Retry (re-runs the loaders). */
export function LoaderErrorBanner({ error }: { error: ApiError }) {
  const router = useRouter();
  const queryReset = useQueryErrorResetBoundary();
  // Let suspense queries that failed fetch again when the route re-renders.
  useEffect(() => queryReset.reset(), [queryReset]);
  return (
    <StatePage state="error">
      <RouteLoadError
        title={error.title}
        detail={error.detail}
        requestId={error.requestId}
        onRetry={() => void router.invalidate()}
      />
    </StatePage>
  );
}

/** A 401 while loading: the session is gone. Starts the once-guarded sign-out path and shows pending meanwhile. */
function SigningOut() {
  useEffect(() => void signOutAndRedirect(), []);
  return <RoutePending />;
}

export function RouteError({ error }: ErrorComponentProps) {
  if (error instanceof ApiError) {
    if (error.status === 401) return <SigningOut />;
    if (error.status === 404) return <NotFound />;
    if (error.status === 403) return isOrgSuspendedError(error) ? <SuspendedOrgPage /> : <Forbidden />;
    if (error.status === 0 || error.status >= 500) return <LoaderErrorBanner error={error} />;
  }
  return (
    <StatePage state="error" centered>
      <RootErrorBoundary error={error} />
    </StatePage>
  );
}

/** Shown when a route takes longer than 300 ms to load. Areas replace it with their own skeletons. */
export function RoutePending() {
  return (
    <StatePage state="loading">
      <RouteSkeleton />
    </StatePage>
  );
}

/** Toast for an inline mutation error: the problem title (and detail) for API errors. */
export function toastFromError(e: unknown): ToastInput {
  if (isOrgMismatch(e)) return { tone: 'err', title: ORG_SWITCHED_MESSAGE };
  if (e instanceof ApiError)
    return { tone: 'err', title: e.title, ...(e.detail !== undefined && { detail: e.detail }) };
  if (e instanceof Error && e.message) return { tone: 'err', title: 'Something went wrong', detail: e.message };
  return { tone: 'err', title: 'Something went wrong' };
}
