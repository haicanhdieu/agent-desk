import type { ReactNode } from 'react';
import { Banner, Button, Icon, Skeleton } from '@/ds';
import {
  EmptyState,
  KeyValue,
  OrgStatus,
  PlatformOrgHeader,
  RouteLoadError,
  SuspendOrgDialog,
  type PlatformOrgHeaderProps,
  type SuspendOrgDialogProps,
} from '@/components';
import type { PlatformOrgOverviewView } from '@/mocks';
import styles from './Screens.module.css';

export type PlatformOrgDetailView =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; requestId?: string; onRetry: () => void }
  | { kind: 'notFound'; backHref: string }
  | { kind: 'ready'; header: PlatformOrgHeaderProps; overview: PlatformOrgOverviewView };

export interface PlatformOrgDetailProps {
  view: PlatformOrgDetailView;
  /** The suspend or reactivate dialog, when one is open. */
  dialog?: SuspendOrgDialogProps;
  /** Where the route mounts its Edit organization dialog. */
  editSlot?: ReactNode;
}

/** Platform org detail: header, the suspended warning and the Overview facts. Names and reasons are text, never HTML. */
export function PlatformOrgDetail({ view, dialog, editSlot }: PlatformOrgDetailProps) {
  return (
    <main className={styles.platformMain}>
      {view.kind === 'loading' && (
        <div className={styles.platformLoading} aria-busy="true" role="status" aria-label="Loading">
          <span aria-hidden="true">
            <Skeleton variant="block" height={28} width={240} />
          </span>
          <span className={styles.membersLoadingRows} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} variant="block" height={20} width={420} />
            ))}
          </span>
        </div>
      )}
      {view.kind === 'error' && <RouteLoadError title={view.title} requestId={view.requestId} onRetry={view.onRetry} />}
      {view.kind === 'notFound' && (
        <EmptyState
          headingLevel={2}
          title="Page not found"
          body="This organization does not exist."
          action={
            <Button variant="primary" href={view.backHref}>
              Back to organizations
            </Button>
          }
        />
      )}
      {view.kind === 'ready' && (
        <>
          <PlatformOrgHeader {...view.header} />
          {view.overview.suspension && (
            <Banner
              tone="warn"
              icon={<Icon name="warning" size={18} />}
              live="polite"
              title="This organization is suspended"
            >
              <p>
                {`Since ${view.overview.suspension.since}${view.overview.suspension.by ? ` by ${view.overview.suspension.by}` : ''}. People cannot open it and no new runs start.`}
              </p>
              <p>{`Reason: ${view.overview.suspension.reason}`}</p>
            </Banner>
          )}
          <h2>Overview</h2>
          <KeyValue
            termWidth={120}
            items={[
              { term: 'Slug', value: `/o/${view.overview.facts.slug}` },
              { term: 'Owner', value: view.overview.facts.owner ?? 'No owner yet' },
              { term: 'Members', value: view.overview.facts.members },
              { term: 'Projects', value: view.overview.facts.projects },
              { term: 'Last activity', value: view.overview.facts.lastActivity ?? 'No activity yet' },
              { term: 'Created', value: view.overview.facts.created },
              { term: 'Status', value: <OrgStatus status={view.overview.facts.status} /> },
            ]}
          />
        </>
      )}
      {dialog && <SuspendOrgDialog {...dialog} />}
      {editSlot}
    </main>
  );
}
