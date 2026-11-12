import { ProjectRunEvent } from '@agentdesk/contracts';
import { sseProjectPath } from '@agentdesk/contracts/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { projectsQueries } from '../projects/queries';
import { applyRunStatus, isStreaming } from './applyEvents';
import { runsKey, runsQueries } from './queries';
import { parseMessage } from './sse';

/** The stream closes after the tab has been hidden this long. */
export const PROJECT_STREAM_HIDDEN_MS = 60_000;
/** After the browser gives up on the stream (CLOSED), the hook opens a new one this much later. */
export const PROJECT_STREAM_RETRY_MS = 5_000;

/** Runs queries and the project's counts refetch: events may have been missed while the stream was closed. */
function catchUp(qc: QueryClient, org: string, projectId: string) {
  void qc.invalidateQueries({ queryKey: runsKey(org, projectId) });
  void qc.invalidateQueries({
    queryKey: projectsQueries.detail(org, projectId).queryKey,
    exact: true,
  });
}

/**
 * The project's run status stream (spec §5.2), mounted by the `$project` layout. Each `run` message patches the
 * run's rows in the cached runs lists and the project counts (applyRunStatus); a run detail that is cached but has no
 * event stream of its own is refetched (with its log). The stream closes once the tab has been hidden for
 * PROJECT_STREAM_HIDDEN_MS; when the tab is visible again it reopens and the runs queries refetch to catch up.
 */
export function useProjectEvents(org: string, projectId: string): void {
  const qc = useQueryClient();

  useEffect(() => {
    let source: EventSource | undefined;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const close = () => {
      clearTimeout(retry);
      source?.close();
      source = undefined;
    };

    const connect = () => {
      const es = new EventSource(sseProjectPath(projectId));
      source = es;
      es.addEventListener('error', () => {
        if (es.readyState !== EventSource.CLOSED || source !== es) return;
        close();
        retry = setTimeout(() => {
          connect();
          catchUp(qc, org, projectId);
        }, PROJECT_STREAM_RETRY_MS);
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
      if (document.hidden) {
        clearTimeout(hiddenTimer);
        hiddenTimer = setTimeout(close, PROJECT_STREAM_HIDDEN_MS);
        return;
      }
      clearTimeout(hiddenTimer);
      if (source === undefined) {
        clearTimeout(retry);
        connect();
        catchUp(qc, org, projectId);
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
