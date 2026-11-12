import { RunEventMessage, RunStatusEvent } from '@agentdesk/contracts';
import { sseRunPath } from '@agentdesk/contracts/client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ConnectionState } from '@/components';
import { applyRunEvent, applyRunStatus, lastSeqOf, markStreaming } from './applyEvents';
import { isFinal } from './map';
import { runsQueries } from './queries';
import { parseMessage } from './sse';

/** After the browser gives up on the stream (CLOSED), the hook opens a new one this much later. */
export const RUN_STREAM_RETRY_MS = 3_000;
/** After a final status the log is reloaded at once and again this much later (scrollback stored late). */
export const FINAL_LOG_RECHECK_MS = 3_000;

/**
 * The run's event stream (spec §5.1), while `enabled` (the run is not final). `event` messages go into the run's
 * events list by `seq` (a replayed backlog after a reconnect is applied once); `status` messages patch the run
 * everywhere it is cached. The browser reconnects by itself and sends `Last-Event-ID` (each message's id is its
 * seq); only when it gives up does the hook open a new stream, with `after=` the last seq seen. A final status ends
 * the stream and reloads the log for the final scrollback.
 *
 * Returns the indicator state: `reconnecting` while connecting, `live` while open, `ended` once final.
 */
export function useRunEvents(
  org: string,
  projectId: string,
  number: number,
  runId: string,
  enabled = true,
): ConnectionState {
  const qc = useQueryClient();
  // Keyed by run so a stale state from the previous run never shows.
  const [conn, setConn] = useState<{ runId: string; state: ConnectionState }>({
    runId,
    state: 'reconnecting',
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const eventsKey = runsQueries.events(org, projectId, number).queryKey;
    let lastSeq = lastSeqOf(qc.getQueryData(eventsKey));
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const unmark = markStreaming(qc, runId);
    const set = (state: ConnectionState) => setConn({ runId, state });
    const seen = (seq: number) => {
      lastSeq = Math.max(lastSeq, seq);
    };

    const connect = () => {
      const es = new EventSource(sseRunPath(runId, lastSeq > 0 ? lastSeq : undefined));
      source = es;
      es.addEventListener('open', () => set('live'));
      es.addEventListener('error', () => {
        if (done) return;
        set('reconnecting');
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          retry = setTimeout(connect, RUN_STREAM_RETRY_MS);
        }
      });
      es.addEventListener('event', (ev) => {
        const e = parseMessage(RunEventMessage, ev);
        if (!e) return;
        seen(e.seq);
        qc.setQueryData(eventsKey, (list) => list && applyRunEvent(list, e));
      });
      es.addEventListener('status', (ev) => {
        const e = parseMessage(RunStatusEvent, ev);
        if (!e || e.runId !== runId) return;
        seen(e.seq);
        applyRunStatus(qc, org, projectId, e);
        if (!isFinal(e.status)) return;
        done = true;
        es.close();
        set('ended');
        // The detail (finish time, cost) and, under its key, the log with the final scrollback; the log once more
        // a little later in case the scrollback was stored just after the status changed.
        void qc.invalidateQueries({
          queryKey: runsQueries.detail(org, projectId, number).queryKey,
        });
        setTimeout(() => void qc.invalidateQueries({ queryKey: eventsKey, exact: true }), FINAL_LOG_RECHECK_MS);
      });
    };

    connect();
    return () => {
      done = true;
      clearTimeout(retry);
      source?.close();
      unmark();
    };
  }, [qc, org, projectId, number, runId, enabled]);

  if (!enabled) return 'ended';
  return conn.runId === runId ? conn.state : 'reconnecting';
}
