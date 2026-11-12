import { ApiError } from '@agentdesk/contracts/client';
import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { useRouter, useRouterState, type ErrorComponentProps } from '@tanstack/react-router';
import { useEffect } from 'react';
import { EmptyState } from '@/components';
import { Banner, Button, Icon, Skeleton, type ToastInput } from '@/ds';
import styles from './boundaries.module.css';

// Error, not-found and pending UI for routes (spec §6). Route `errorComponent`s go through `RouteError`, which
// picks the state from the error: 404 → NotFound, 403 → Forbidden, 5xx / network → LoaderErrorBanner, anything
// else → RootErrorBoundary.

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

export function Forbidden() {
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
    <div className={styles.banner}>
      <Banner
        tone="err"
        icon={<Icon name="warning" />}
        title={error.title}
        live="assertive"
        centered
        actions={
          <Button icon="refresh" onClick={() => void router.invalidate()}>
            Retry
          </Button>
        }
      >
        {error.detail}
        {error.requestId && <span className={styles.requestId}> Request ID: {error.requestId}</span>}
      </Banner>
    </div>
  );
}

export function RouteError({ error }: ErrorComponentProps) {
  if (error instanceof ApiError) {
    if (error.status === 404) return <NotFound />;
    if (error.status === 403) return <Forbidden />;
    if (error.status === 0 || error.status >= 500) return <LoaderErrorBanner error={error} />;
  }
  return <RootErrorBoundary error={error} />;
}

/** Shown when a route takes longer than 300 ms to load. Areas replace it with their own skeletons. */
export function RoutePending() {
  return (
    <div className={styles.pending} aria-busy="true" role="status" aria-label="Loading">
      <Skeleton variant="block" height={28} width="40%" />
      <Skeleton variant="text" lines={4} />
    </div>
  );
}

/** Toast for an inline mutation error: the problem title (and detail) for API errors. */
export function toastFromError(e: unknown): ToastInput {
  if (e instanceof ApiError)
    return { tone: 'err', title: e.title, ...(e.detail !== undefined && { detail: e.detail }) };
  if (e instanceof Error && e.message) return { tone: 'err', title: 'Something went wrong', detail: e.message };
  return { tone: 'err', title: 'Something went wrong' };
}
