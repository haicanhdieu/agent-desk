import { ApiError } from '@agentdesk/contracts/client';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { useRouter, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import {
  EmptyState,
  NO_PAGE_CRUMBS,
  RouteLoadError,
  RouteSkeleton,
  TopBar,
  pageTitle,
  useDocumentTitle,
} from '@/components';
import { Button, type ToastInput } from '@/ds';
import { ORG_SWITCHED_MESSAGE, isOrgMismatch } from '@/features/auth/orgResync';
import { isOrgSuspendedError } from '@/features/auth/orgSuspended';
import { signOutAndRedirect } from '@/features/auth/signOut';
import { useAppBar } from '@/features/chrome/appBar';
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
  return (
    <Button href={org ? `/o/${org}/projects` : '/'} variant="primary">
      Go to projects
    </Button>
  );
}

export function NotFound() {
  useDocumentTitle(pageTitle({ crumbs: NO_PAGE_CRUMBS, state: 'notFound' }));
  return (
    <div className={styles.page}>
      <EmptyState
        title="Page not found"
        body="This page does not exist, or it belongs to an organization you are not in."
        action={<ProjectsLink />}
      />
    </div>
  );
}

/** `titled={false}` when a TopBar rendered beside it already owns the page title (one title source per page). */
export function Forbidden({ titled = true }: { titled?: boolean } = {}) {
  useDocumentTitle(titled ? pageTitle({ crumbs: NO_PAGE_CRUMBS, state: 'forbidden' }) : undefined);
  return (
    <div className={styles.page}>
      <EmptyState
        title="You don't have access"
        body="Ask an owner of this organization to give you access."
        action={<ProjectsLink />}
      />
    </div>
  );
}

/** The platform area for someone who is not a platform admin: the normal org top bar and no platform data. */
export function PlatformForbidden() {
  const bar = useAppBar(null);
  return (
    <>
      <TopBar variant="global" crumbs={NO_PAGE_CRUMBS} state="forbidden" user={bar.user} org={bar.org} tabs="org" />
      <div className={styles.page}>
        <EmptyState
          title="You don't have access"
          body="This area is for platform admins."
          action={
            <Button href="/projects" variant="primary">
              Go to projects
            </Button>
          }
        />
      </div>
    </>
  );
}

/**
 * A member's view of a suspended org: the top bar (switcher included, so they can leave) and the fixed message. The
 * bar reads the session-wide data only, never the refused org-scoped access, and nothing of the org is loaded.
 */
export function SuspendedOrgPage() {
  const slug = useOrgSlug();
  const bar = useAppBar(null);
  const name = bar.org.orgs.find((o) => o.slug === slug)?.name ?? 'this organization';
  return (
    <>
      <TopBar variant="global" crumbs={NO_PAGE_CRUMBS} user={bar.user} org={bar.org} tabs="org" />
      <OrgSuspended orgName={name} />
    </>
  );
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
    <RouteLoadError
      title={error.title}
      detail={error.detail}
      requestId={error.requestId}
      onRetry={() => void router.invalidate()}
    />
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
  return <RootErrorBoundary error={error} />;
}

/** Shown when a route takes longer than 300 ms to load. Areas replace it with their own skeletons. */
export function RoutePending() {
  return <RouteSkeleton />;
}

/** Toast for an inline mutation error: the problem title (and detail) for API errors. */
export function toastFromError(e: unknown): ToastInput {
  if (isOrgMismatch(e)) return { tone: 'err', title: ORG_SWITCHED_MESSAGE };
  if (e instanceof ApiError)
    return { tone: 'err', title: e.title, ...(e.detail !== undefined && { detail: e.detail }) };
  if (e instanceof Error && e.message) return { tone: 'err', title: 'Something went wrong', detail: e.message };
  return { tone: 'err', title: 'Something went wrong' };
}
