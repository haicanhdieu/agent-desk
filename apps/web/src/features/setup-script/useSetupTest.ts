import { RunEventDto, SetupTestDto } from '@agentdesk/contracts';
import { apiPath } from '@agentdesk/contracts/client';
import { useEffect, useState } from 'react';
import { applyRunEvent } from '../runs/applyEvents';
import { parseMessage, STREAM_MAX_ATTEMPTS, streamRetryDelay } from '../runs/sse';

export interface SetupTestStream {
  /** The test as the stream last sent it; null until the first `status` frame. */
  test: SetupTestDto | null;
  /** The test's log events by `seq`. */
  events: RunEventDto[];
}

interface State extends SetupTestStream {
  id: string | undefined;
}

const empty = (id: string | undefined): State => ({ id, test: null, events: [] });

/**
 * The setup test's event stream (spec §5.5): `status` frames (the test) and `event` frames (its log) from
 * `setupTests.events`, while `testId` is set and the test has not ended. The browser reconnects by itself and sends
 * `Last-Event-ID`; only when it gives up (CLOSED) does the hook open a new stream with `after=` the last `seq` seen,
 * backing off and stopping after STREAM_MAX_ATTEMPTS failures in a row. A test that has ended ends the stream. A new
 * `testId` starts from nothing.
 */
export function useSetupTest(testId: string | undefined): SetupTestStream {
  const [state, setState] = useState<State>(() => empty(testId));

  useEffect(() => {
    if (testId === undefined) return undefined;
    let lastSeq = 0;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let done = false;
    const update = (change: (s: State) => State) => setState((s) => change(s.id === testId ? s : empty(testId)));

    const connect = () => {
      const base = apiPath('setupTests.events', { setupTestId: testId });
      const es = new EventSource(lastSeq > 0 ? `${base}?after=${lastSeq}` : base);
      source = es;
      es.addEventListener('open', () => {
        attempts = 0;
      });
      es.addEventListener('error', () => {
        if (done || es.readyState !== EventSource.CLOSED) return;
        es.close();
        if (attempts >= STREAM_MAX_ATTEMPTS) return;
        retry = setTimeout(connect, streamRetryDelay(attempts));
        attempts += 1;
      });
      es.addEventListener('event', (ev) => {
        const e = parseMessage(RunEventDto, ev);
        if (!e) return;
        lastSeq = Math.max(lastSeq, e.seq);
        update((s) => ({ ...s, events: applyRunEvent(s.events, e) }));
      });
      es.addEventListener('status', (ev) => {
        const t = parseMessage(SetupTestDto, ev);
        if (!t || t.id !== testId) return;
        update((s) => ({ ...s, test: t }));
        if (t.status !== 'ended') return;
        done = true;
        es.close();
      });
    };

    connect();
    return () => {
      done = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [testId]);

  return state.id === testId ? { test: state.test, events: state.events } : { test: null, events: [] };
}
