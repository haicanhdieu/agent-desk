/**
 * Keeps each run's workflow told which terminal sockets are open. While at least one socket of a run is tracked, a timer
 * sends that run's live connection ids every interval; the last untrack stops it. The workflow drops an id it has not
 * heard about for 5 minutes, so a crashed API stops blocking the idle timer on its own.
 *
 * Only sockets that passed authorization and whose attach signal was delivered are ever tracked (the gateway's call), so
 * an id here is always one the API made for an authorized socket.
 */
export type LeaseSender = (connectionIds: string[]) => void;

interface Run {
  readonly ids: Set<string>;
  readonly timer: NodeJS.Timeout;
}

export class TerminalLeases {
  private readonly runs = new Map<string, Run>();

  /** `intervalMs` is read when a run's timer starts (a test seam lives on the gateway). */
  constructor(private readonly intervalMs: () => number) {}

  /** Number of runs with a timer running. */
  runCount(): number {
    return this.runs.size;
  }

  track(key: string, connectionId: string, send: LeaseSender): void {
    const run = this.runs.get(key);
    if (run) {
      run.ids.add(connectionId);
      return;
    }
    const ids = new Set([connectionId]);
    const timer = setInterval(() => send([...ids]), this.intervalMs());
    this.runs.set(key, { ids, timer });
  }

  untrack(key: string, connectionId: string): void {
    const run = this.runs.get(key);
    if (!run?.ids.delete(connectionId)) return;
    if (run.ids.size > 0) return;
    clearInterval(run.timer);
    this.runs.delete(key);
  }

  /** Clears every timer (shutdown). */
  stop(): void {
    for (const run of this.runs.values()) clearInterval(run.timer);
    this.runs.clear();
  }
}
