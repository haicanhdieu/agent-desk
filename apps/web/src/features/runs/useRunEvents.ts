import { RunEventMessage, RunStatusEvent } from '@agentdesk/contracts';
import { sseRunPath } from '@agentdesk/contracts/client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '@/components';
import { applyRunEvent, applyRunStatus, lastSeqOf, markStreaming } from './applyEvents';
import { isFinal } from './map';
import { runsQueries } from './queries';
import { parseMessage, STREAM_MAX_ATTEMPTS, streamRetryDelay } from './sse';

/** After a run turns final its log is reloaded at once and again this much later (scrollback stored late). */
export const FINAL_LOG_RECHECK_MS = 3_000;

/**
 * The run's event stream (spec §5.1), while `enabled` (the run is not final). `event` messages go into the run's
 * events list by `seq` (a replayed backlog after a reconnect is applied once); `status` messages patch the run
 * everywhere it is cached. The browser reconnects by itself and sends `Last-Event-ID` (each message's id is its
 * seq); only when it gives up (CLOSED: 401, 404, …) does the hook open a new stream, with `after=` the last seq seen,
 * backing off (streamRetryDelay) and stopping after STREAM_MAX_ATTEMPTS failures in a row. A final status ends the
 * stream (useFinalLogReload then reloads the run and its log).
 *
 * Returns the indicator state: `reconnecting` while connecting (or after giving up), `live` while open, `ended`
 * once final.
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
  const [conn, setConn] = useState<{ runId: string; state: ConnectionState }>({ runId, state: 'reconnecting' });

  useEffect(() => {
    if (!enabled) return undefined;
    const eventsKey = runsQueries.events(org, projectId, number).queryKey;
    let lastSeq = lastSeqOf(qc.getQueryData(eventsKey));
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let done = false;
    const unmark = markStreaming(qc, runId);
    const set = (state: ConnectionState) => setConn({ runId, state });
    const seen = (seq: number) => {
      lastSeq = Math.max(lastSeq, seq);
    };

    const connect = () => {
      const es = new EventSource(sseRunPath(runId, lastSeq > 0 ? lastSeq : undefined));
      source = es;
      es.addEventListener('open', () => {
        attempts = 0;
        set('live');
      });
      es.addEventListener('error', () => {
        if (done) return;
        set('reconnecting');
        if (es.readyState !== EventSource.CLOSED) return;
        es.close();
        if (attempts >= STREAM_MAX_ATTEMPTS) return;
        retry = setTimeout(connect, streamRetryDelay(attempts));
        attempts += 1;
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

/**
 * When the open run turns final (from its stream or a refetch; not when it was loaded final), its detail (finish time,
 * cost) and log (final scrollback) reload, and the log once more after FINAL_LOG_RECHECK_MS in case the scrollback
 * was stored just after the status changed. The one place that reloads them for a final status.
 */
export function useFinalLogReload(org: string, projectId: string, number: number, final: boolean): void {
  const qc = useQueryClient();
  const wasFinal = useRef(final);
  const wasNumber = useRef(number);
  useEffect(() => {
    const turnedFinal = final && !wasFinal.current && wasNumber.current === number;
    wasFinal.current = final;
    wasNumber.current = number;
    if (!turnedFinal) return undefined;
    // Prefix: the detail and its log.
    void qc.invalidateQueries({ queryKey: runsQueries.detail(org, projectId, number).queryKey });
    const recheck = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: runsQueries.events(org, projectId, number).queryKey, exact: true });
    }, FINAL_LOG_RECHECK_MS);
    return () => clearTimeout(recheck);
  }, [final, qc, org, projectId, number]);
}
