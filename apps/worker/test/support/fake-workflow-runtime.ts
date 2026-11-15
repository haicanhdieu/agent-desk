// A small in-process stand-in for `@temporalio/workflow`, so workflow functions run directly under vitest. The
// Temporal test environment bundles workflow code into its sandbox, where v8 coverage cannot see it; running the same
// functions here keeps their behaviour measured. Only the pieces the covered workflows use are implemented.

type Fn = (...args: unknown[]) => unknown;
interface Def {
  name: string;
}
interface Waiter {
  predicate: () => boolean;
  settle: (met: boolean) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Thrown by `continueAsNew`, like the real one unwinds the workflow; carries the next run's arguments. */
export class FakeContinueAsNew extends Error {
  constructor(readonly args: unknown[]) {
    super('continue as new');
  }
}
class FakeCancelled extends Error {}

export const runtime = {
  /** Activities the workflow under test can call, by name. Set per test. */
  activities: {} as Record<string, Fn>,
  handlers: new Map<string, Fn>(),
  waiters: new Set<Waiter>(),
  sleeps: [] as number[],
  /** Names of external workflows signalled, as `id:signal`. */
  externalSignals: [] as string[],
  /** External workflow ids whose signal should throw (the workflow is gone). */
  externalGone: new Set<string>(),
};

export function resetRuntime(): void {
  runtime.activities = {};
  runtime.handlers.clear();
  for (const w of runtime.waiters) if (w.timer !== undefined) clearTimeout(w.timer);
  runtime.waiters.clear();
  runtime.sleeps = [];
  runtime.externalSignals = [];
  runtime.externalGone.clear();
}

/** Re-evaluates every `condition` wait; call after anything that could change workflow state. */
function poke(): void {
  for (const w of [...runtime.waiters]) {
    if (!w.predicate()) continue;
    if (w.timer !== undefined) clearTimeout(w.timer);
    runtime.waiters.delete(w);
    w.settle(true);
  }
}

/** Delivers a signal to the handler the workflow registered. */
export function sendSignal(def: Def, ...args: unknown[]): void {
  const handler = runtime.handlers.get(def.name);
  if (!handler) throw new Error(`no handler for ${def.name}`);
  handler(...args);
  poke();
}

export function runQuery<T>(def: Def): T {
  const handler = runtime.handlers.get(def.name);
  if (!handler) throw new Error(`no handler for ${def.name}`);
  return handler() as T;
}

/** Lets pending promise continuations (and timers set to 0) run. */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

export const defineSignal = (name: string): Def => ({ name });
export const defineQuery = (name: string): Def => ({ name });
export const defineUpdate = (name: string): Def => ({ name });
export const setHandler = (def: Def, handler: Fn): void => {
  runtime.handlers.set(def.name, handler);
};

export function proxyActivities(): Record<string, Fn> {
  return new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          const fn = typeof name === 'string' ? runtime.activities[name] : undefined;
          if (!fn) return Promise.reject(new Error(`activity ${String(name)} is not stubbed`));
          return Promise.resolve(fn(...args));
        },
    },
  );
}

export function sleep(ms: number): Promise<void> {
  runtime.sleeps.push(ms);
  return Promise.resolve();
}

export function condition(predicate: () => boolean, timeoutMs?: number): Promise<boolean> {
  if (predicate()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const waiter: Waiter = { predicate, settle: resolve, timer: undefined };
    if (timeoutMs !== undefined) {
      waiter.timer = setTimeout(() => {
        runtime.waiters.delete(waiter);
        resolve(false);
      }, timeoutMs);
    }
    runtime.waiters.add(waiter);
  });
}

export const ActivityCancellationType = { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' } as const;
export const isCancellation = (err: unknown): boolean => err instanceof FakeCancelled;

export class CancellationScope {
  private rejectCancel: ((err: Error) => void) | undefined;
  private readonly cancelled = new Promise<never>((_, reject) => {
    this.rejectCancel = reject;
  });
  constructor() {
    // The race below is the only consumer; keep an unraced cancel from being an unhandled rejection.
    this.cancelled.catch(() => undefined);
  }
  run<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.race([fn(), this.cancelled]);
  }
  cancel(): void {
    this.rejectCancel?.(new FakeCancelled('cancelled'));
  }
  static nonCancellable<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export function getExternalWorkflowHandle(id: string): { signal: (def: Def) => Promise<void> } {
  return {
    signal: (def) => {
      if (runtime.externalGone.has(id)) return Promise.reject(new Error('workflow not found'));
      runtime.externalSignals.push(`${id}:${def.name}`);
      return Promise.resolve();
    },
  };
}

export function continueAsNew(...args: unknown[]): Promise<never> {
  return Promise.reject(new FakeContinueAsNew(args));
}
