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
/**
 * A connection resets the back-off only after staying open this long: a server that accepts and then closes at once
 * still moves through TERMINAL_BACKOFF_MS to `gave_up` instead of retrying every second forever.
 */
export const STABLE_OPEN_MS = 5_000;
/** Container resizes closer together than this send one resize frame. */
export const RESIZE_DEBOUNCE_MS = 100;

/** Close codes the server uses (spec §5.3). 1000: the exec session ended (the pod's tmux exited, e.g. the run finished). */
const CLOSE_NORMAL = 1000;
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

/** `ws(s)://<this host><path>`; the scheme follows the page. */
function terminalUrl(path: string): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}${path}`;
}

const resizeFrame = ({ cols, rows }: TerminalSize) => JSON.stringify({ type: 'resize', cols, rows });

/**
 * What the owner of a terminal does when its session ended (close codes 1000 and 4409): refetch whatever shows the
 * owner's state. Resolving `true` means the owner is still active (the socket then retries, or gives up after a
 * 4409); anything else (no return value, `false`) means it ended, and the page shows its end state.
 */
export type OnSessionEnd = () => void | Promise<boolean>;

/**
 * A terminal socket at `path` (spec §5.3) while `enabled` (the owner is active and the terminal is mounted). Binary
 * frames both ways: output is written to `term`, keystrokes are sent as UTF-8. Text frames from the server are
 * ignored (never acted on). Close codes: 4401 → the sign-out path; 4403 → `forbidden`, no retry; 4409 → the owner is
 * no longer active: `connecting` while `onSessionEnd` runs (the page then shows the end state), no retry; 1000 (the
 * session ended) → `onSessionEnd` too, and only an owner still active then retries. Any other close retries after
 * TERMINAL_BACKOFF_MS, then `gave_up`; only a connection that stayed open STABLE_OPEN_MS resets the back-off.
 * Unmounting, or `enabled` turning false, closes the socket and cancels a pending retry. Terminal data is never
 * logged. `onSessionEnd` must be stable (memoised): a new function opens a new connection.
 */
export function useTerminalSocket(
  path: string,
  enabled: boolean,
  term: RefObject<LiveTerminalHandle | null>,
  onSessionEnd: OnSessionEnd,
): UseTerminal {
  // Bumped by reconnect(): a new connection (the effect re-runs).
  const [attempt, setAttempt] = useState(0);
  const session = `${path}:${attempt}`;
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
    let stable: ReturnType<typeof setTimeout> | undefined;
    const set = (state: TerminalState) => {
      if (!disposed) setCurrent({ session, state });
    };

    const retryLater = () => {
      const delay = TERMINAL_BACKOFF_MS[retries];
      if (delay === undefined) {
        set('gave_up');
        return;
      }
      retries += 1;
      set('retrying');
      retry = setTimeout(connect, delay);
    };

    /** `connecting` while the owner is refetched; `onStillActive` runs when it is still active after that. */
    const sessionEnded = (onStillActive: () => void) => {
      set('connecting');
      void Promise.resolve(onSessionEnd()).then((stillActive) => {
        if (!disposed && stillActive === true) onStillActive();
      });
    };

    const onClose = (code: number) => {
      socket.current = null;
      clearTimeout(stable);
      switch (code) {
        case CLOSE_NORMAL:
          // Usually the owner ended (the page then shows its end state); one still active reattaches.
          sessionEnded(retryLater);
          return;
        case CLOSE_UNAUTHORIZED:
          void signOutAndRedirect();
          return;
        case CLOSE_FORBIDDEN:
          set('forbidden');
          return;
        case CLOSE_RUN_GONE:
          // The owner ended: the page shows its end state once refetched. If it is still active after that, only a
          // manual reconnect is offered (no loop).
          sessionEnded(() => set('gave_up'));
          return;
        default:
          retryLater();
      }
    };

    const connect = () => {
      const ws = new WebSocket(terminalUrl(path));
      ws.binaryType = 'arraybuffer';
      socket.current = ws;
      ws.addEventListener('open', () => {
        if (disposed) return;
        stable = setTimeout(() => {
          retries = 0;
        }, STABLE_OPEN_MS);
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
      clearTimeout(stable);
      clearTimeout(resizeTimer.current);
      socket.current?.close(1000);
      socket.current = null;
    };
  }, [enabled, path, session, term, onSessionEnd]);

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

/**
 * The run's terminal socket (spec §5.3) while `enabled` (the run is running or idle and the terminal is mounted).
 * See `useTerminalSocket` for the protocol. When the session ends the run's detail refetches (the route then shows
 * the final scrollback); a run still active after that retries (1000) or offers a manual reconnect (4409).
 */
export function useTerminal(
  runId: string,
  enabled: boolean,
  term: RefObject<LiveTerminalHandle | null>,
  run: TerminalRun,
): UseTerminal {
  const qc = useQueryClient();
  const { org, projectId, number } = run;
  const onSessionEnd = useCallback(async () => {
    const detailKey = runsQueries.detail(org, projectId, number).queryKey;
    await qc.invalidateQueries({ queryKey: detailKey });
    const status = qc.getQueryData(detailKey)?.status;
    return status === undefined || !isFinal(status);
  }, [qc, org, projectId, number]);
  return useTerminalSocket(terminalPath(runId), enabled, term, onSessionEnd);
}
