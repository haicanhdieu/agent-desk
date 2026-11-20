import { Banner, Button, Icon, Skeleton } from '@/ds';
import styles from './RouteStates.module.css';

/** What a route shows while its first load runs: a busy status with two skeletons. */
export function RouteSkeleton() {
  return (
    <div className={styles.pending} aria-busy="true" role="status" aria-label="Loading">
      <Skeleton variant="block" height={28} width="40%" />
      <Skeleton variant="text" lines={4} />
    </div>
  );
}

export interface RouteLoadErrorProps {
  title: string;
  detail?: string | undefined;
  requestId?: string | undefined;
  onRetry(): void;
}

/** A failed first load: the problem title and detail, the request ID and Retry. */
export function RouteLoadError({ title, detail, requestId, onRetry }: RouteLoadErrorProps) {
  return (
    <div className={styles.banner}>
      <Banner
        tone="err"
        icon={<Icon name="warning" />}
        title={title}
        live="assertive"
        centered
        actions={
          <Button icon="refresh" onClick={onRetry}>
            Retry
          </Button>
        }
      >
        {detail}
        {requestId && <span className={styles.requestId}> Request ID: {requestId}</span>}
      </Banner>
    </div>
  );
}
