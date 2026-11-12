import { ProjectRunEvent } from '@agentdesk/contracts';
import { sseProjectPath } from '@agentdesk/contracts/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { projectsQueries } from '../projects/queries';
import { applyRunStatus, isStreaming } from './applyEvents';
import { runsKey, runsQueries } from './queries';
import { parseMessage, STREAM_MAX_ATTEMPTS, streamRetryDelay } from './sse';

/** The stream closes after the tab has been hidden this long. */
export const PROJECT_STREAM_HIDDEN_MS = 60_000;

/** Runs queries and the project's counts refetch: events may have been missed while the stream was down. */
function catchUp(qc: QueryClient, org: string, projectId: string) {
  void qc.invalidateQueries({ queryKey: runsKey(org, projectId) });
  void qc.invalidateQueries({ queryKey: projectsQueries.detail(org, projectId).queryKey, exact: true });
}

/**
 * The project's run status stream (spec §5.2), mounted by the `$project` layout. Each `run` message patches the
 * run's rows in the cached runs lists and the project counts (applyRunStatus); a run detail that is cached but has no
 * event stream of its own is refetched (with its log).
 *
 * The stream has no replay, so whenever it opens again after a gap (the browser's own reconnect, a re-open after the
 * browser gave up, or a re-open on visibility) the runs queries refetch once it is open. A stream the browser gave up
 * on (CLOSED) is re-opened with back-off (streamRetryDelay), at most STREAM_MAX_ATTEMPTS times in a row; after that
 * REST refetches (focus, navigation) take over. The stream closes once the tab has been hidden for
 * PROJECT_STREAM_HIDDEN_MS and re-opens when it is visible again.
 */
export function useProjectEvents(org: string, projectId: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    let source: EventSource | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    /** The next `open` follows a gap: catch up then. */
    let gap = false;

    const close = () => {
      clearTimeout(retry);
      retry = undefined;
      source?.close();
      source = undefined;
    };

    const connect = () => {
      const es = new EventSource(sseProjectPath(projectId));
      source = es;
      es.addEventListener('open', () => {
        attempts = 0;
        if (gap) {
          gap = false;
          catchUp(qc, org, projectId);
        }
      });
      es.addEventListener('error', () => {
        if (source !== es) return;
        gap = true;
        if (es.readyState !== EventSource.CLOSED) return; // the browser reconnects by itself
        close();
        if (attempts >= STREAM_MAX_ATTEMPTS) return;
        retry = setTimeout(connect, streamRetryDelay(attempts));
        attempts += 1;
      });
      es.addEventListener('run', (ev) => {
        const e = parseMessage(ProjectRunEvent, ev);
        if (!e) return;
        applyRunStatus(qc, org, projectId, e);
        const detail = runsQueries.detail(org, projectId, e.number).queryKey;
        if (!isStreaming(qc, e.runId) && qc.getQueryData(detail) !== undefined) {
          // Prefix: the detail and its log.
          void qc.invalidateQueries({ queryKey: detail });
        }
      });
    };

    const onVisibility = () => {
      clearTimeout(hiddenTimer);
      if (document.hidden) {
        hiddenTimer = setTimeout(close, PROJECT_STREAM_HIDDEN_MS);
        return;
      }
      if (source === undefined) {
        close();
        attempts = 0;
        gap = true;
        connect();
      }
    };

    connect();
    if (document.hidden) onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(hiddenTimer);
      close();
    };
  }, [qc, org, projectId]);
}
