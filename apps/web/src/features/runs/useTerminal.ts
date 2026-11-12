import { terminalPath } from '@agentdesk/contracts/client';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LiveTerminalHandle, TerminalSize } from '@/components/LiveTerminal';
import { signOutAndRedirect } from '../auth/signOut';
import { isFinal } from './map';
import { runsQueries } from './queries';

export type TerminalState = 'connecting' | 'open' | 'retrying' | 'gave_up' | 'forbidden';

/** Waits before each retry after an abnormal close; after the last one the hook gives up (RunReconnect). */
export const TERMINAL_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 10_000];
/** Container resizes closer together than this send one resize frame. */
export const RESIZE_DEBOUNCE_MS = 100;

/** Close codes the server uses (spec §5.3). */
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_FORBIDDEN = 4403;
const CLOSE_RUN_GONE = 4409;

export interface TerminalRun {
  org: string;
  projectId: string;
  number: number;
}

export interface UseTerminal {
  state: TerminalState;
  /** Opens a new socket now, with a fresh back-off (RunReconnect's button). */
  reconnect(): void;
  /** LiveTerminal's `onData`: sent as one UTF-8 binary frame while open. */
  onData(data: string): void;
  /** LiveTerminal's `onResize`: sent as a resize text frame after RESIZE_DEBOUNCE_MS, and on every open. */
  onResize(size: TerminalSize): void;
}

/** `ws(s)://<this host>/api/runs/:runId/terminal`; the scheme follows the page. */
function terminalUrl(runId: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${terminalPath(runId)}`;
}

const resizeFrame = ({ cols, rows }: TerminalSize) => JSON.stringify({ type: 'resize', cols, rows });

/**
 * The run's terminal socket (spec §5.3) while `enabled` (the run is running or idle and the terminal is mounted).
 * Binary frames both ways: output is written to `term`, keystrokes are sent as UTF-8. Text frames from the server
 * are ignored (never acted on). Close codes: 4401 → the sign-out path; 4403 → `forbidden`, no retry; 4409 → the run
 * is no longer active: its detail is invalidated (the route then shows the final scrollback), no retry. Any other
 * close retries after TERMINAL_BACKOFF_MS, then `gave_up`. Unmounting, or `enabled` turning false, closes the socket
 * and cancels a pending retry. Terminal data is never logged.
 */
export function useTerminal(
  runId: string,
  enabled: boolean,
  term: RefObject<LiveTerminalHandle | null>,
  run: TerminalRun,
): UseTerminal {
  const qc = useQueryClient();
  const { org, projectId, number } = run;
  // Bumped by reconnect(): a new connection (the effect re-runs).
  const [attempt, setAttempt] = useState(0);
  const session = `${runId}:${attempt}`;
  // Keyed by connection session so a stale state from the previous one never shows.
  const [current, setCurrent] = useState<{ session: string; state: TerminalState }>({ session, state: 'connecting' });
  const socket = useRef<WebSocket | null>(null);
  const size = useRef<TerminalSize | null>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let retries = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const set = (state: TerminalState) => {
      if (!disposed) setCurrent({ session, state });
    };
    const detailKey = runsQueries.detail(org, projectId, number).queryKey;

    const onClose = (code: number) => {
      socket.current = null;
      switch (code) {
        case CLOSE_UNAUTHORIZED:
          void signOutAndRedirect();
          return;
        case CLOSE_FORBIDDEN:
          set('forbidden');
          return;
        case CLOSE_RUN_GONE:
          // The run ended: the route shows its final scrollback once the refetched run is final. If it is still
          // active after the refetch, only a manual reconnect is offered (no loop).
          void qc.invalidateQueries({ queryKey: detailKey }).then(() => {
            const status = qc.getQueryData(detailKey)?.status;
            if (status === undefined || !isFinal(status)) set('gave_up');
          });
          return;
        default: {
          const delay = TERMINAL_BACKOFF_MS[retries];
          if (delay === undefined) {
            set('gave_up');
            return;
          }
          retries += 1;
          set('retrying');
          retry = setTimeout(connect, delay);
        }
      }
    };

    const connect = () => {
      const ws = new WebSocket(terminalUrl(runId));
      ws.binaryType = 'arraybuffer';
      socket.current = ws;
      ws.addEventListener('open', () => {
        if (disposed) return;
        retries = 0;
        set('open');
        if (size.current) ws.send(resizeFrame(size.current));
      });
      ws.addEventListener('message', (e: MessageEvent<unknown>) => {
        if (disposed || !(e.data instanceof ArrayBuffer)) return;
        term.current?.write(new Uint8Array(e.data));
      });
      ws.addEventListener('close', (e: CloseEvent) => {
        if (disposed) return;
        onClose(e.code);
      });
    };

    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearTimeout(resizeTimer.current);
      socket.current?.close(1000);
      socket.current = null;
    };
  }, [enabled, runId, session, org, projectId, number, qc, term]);

  const onData = useCallback((data: string) => {
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data));
  }, []);

  const onResize = useCallback((next: TerminalSize) => {
    size.current = next;
    clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => {
      const ws = socket.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(resizeFrame(next));
    }, RESIZE_DEBOUNCE_MS);
  }, []);

  const reconnect = useCallback(() => setAttempt((a) => a + 1), []);

  const state = enabled && current.session === session ? current.state : 'connecting';
  return { state, reconnect, onData, onResize };
}
