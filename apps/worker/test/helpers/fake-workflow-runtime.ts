// A minimal in-process stand-in for `@temporalio/workflow`, so workflow bodies run directly under vitest. It exists only
// so v8 coverage can see workflow code that Temporal's bundled sandbox hides; it supplements and never replaces the
// time-skipping and replay tests, which stay the check for ordering, retries, cancellation and replay.
//
// Where it diverges from real Temporal:
// - `sleep` resolves immediately, unless `runtime.manualTime` is set: then `sleep` and `condition` timeouts wait for
//   `fireTimer` (nothing advances by itself, so a test decides which timer fires and when).
// - `condition` uses its own waiter set, re-checked after each delivered signal and each settled activity or timer.
// - `CancellationScope.cancel` rejects what is in flight at once (activities, sleeps, conditions, `run`), and does not
//   model WAIT_CANCELLATION_COMPLETED. Scopes follow async calls through AsyncLocalStorage.
// - `CancellationScope.nonCancellable` just runs the function in a scope nothing can cancel.
// - `proxyActivities` ignores retry and timeout options.
// - There are no replay or determinism checks.
// - Signals and updates are delivered synchronously, by the test.
// - `patched` is true unless the test lists the patch in `runtime.unpatched`.
// - `workflowInfo` only has `historyLength` (`runtime.historyLength`); `log` records into `runtime.logs`.
// - `ActivityFailure` and `ApplicationFailure` are the real classes.
import { AsyncLocalStorage } from 'node:async_hooks';
import { vi } from 'vitest';

const actual = await vi.importActual<typeof import('@temporalio/workflow')>('@temporalio/workflow');
export const ActivityFailure = actual.ActivityFailure;
export const ApplicationFailure = actual.ApplicationFailure;

/** What a failed activity looks like to the workflow: an `ActivityFailure` caused by an `ApplicationFailure`. */
export function failedActivity(activityType: string, message: string, type?: string): Error {
  const cause = ApplicationFailure.nonRetryable(message, type);
  return new ActivityFailure('Activity task failed', activityType, '1', 'NON_RETRYABLE_FAILURE', 'worker', cause);
}

/** Any function: stubs and handlers are written with their real parameter types, so the parameters are `never` here. */
type Fn = (...args: never[]) => unknown;
/** The one place arguments are passed untyped: the workflow calls what the test stubbed with matching arguments. */
const call = (fn: Fn, args: unknown[]): unknown => (fn as (...a: unknown[]) => unknown)(...args);
interface Def {
  name: string;
}
interface Waiter {
  predicate: () => boolean;
  settle: (met: boolean) => void;
  off: () => void;
  timer: Timer | undefined;
}
interface Timer {
  ms: number;
  fire: () => void;
}
interface HandlerOptions {
  validator?: Fn;
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
  validators: new Map<string, Fn>(),
  waiters: new Set<Waiter>(),
  sleeps: [] as number[],
  /** Names of external workflows signalled, as `id:signal` (`id:signal:arg,arg` with arguments). */
  externalSignals: [] as string[],
  /** External workflow ids whose signal should throw (the workflow is gone). */
  externalGone: new Set<string>(),
  /** Timers that only `fireTimer` fires; used only when `manualTime` is set. */
  timers: [] as Timer[],
  manualTime: false,
  unpatched: new Set<string>(),
  historyLength: 0,
  logs: [] as string[],
};

export function resetRuntime(): void {
  runtime.activities = {};
  runtime.handlers.clear();
  runtime.validators.clear();
  for (const w of runtime.waiters) w.off();
  runtime.waiters.clear();
  runtime.sleeps = [];
  runtime.externalSignals = [];
  runtime.externalGone.clear();
  runtime.timers = [];
  runtime.manualTime = false;
  runtime.unpatched.clear();
  runtime.historyLength = 0;
  runtime.logs = [];
}

const scopes = new AsyncLocalStorage<CancellationScope>();

/** Re-evaluates every `condition` wait; call after anything that could change workflow state. */
function poke(): void {
  let any = false;
  for (const w of [...runtime.waiters]) {
    if (!w.predicate()) continue;
    runtime.waiters.delete(w);
    w.off();
    w.settle(true);
    any = true;
  }
  // A woken workflow may change state that wakes another wait.
  if (any) schedulePoke();
}

let pokeQueued = false;
/** Re-checks the waits once the current promise continuations have run. */
function schedulePoke(): void {
  if (pokeQueued) return;
  pokeQueued = true;
  setImmediate(() => {
    pokeQueued = false;
    poke();
  });
}

/** Runs `onCancel` when the current scope is cancelled; returns the way to stop listening. */
function onCancel(listener: () => void): () => void {
  const scope = scopes.getStore();
  if (scope === undefined) return () => undefined;
  return scope.listen(listener);
}

/** Delivers a signal to the handler the workflow registered. */
export function sendSignal(def: Def, ...args: unknown[]): void {
  const handler = runtime.handlers.get(def.name);
  if (!handler) throw new Error(`no handler for ${def.name}`);
  call(handler, args);
  poke();
  schedulePoke();
}

/** Delivers an update: the validator runs first (a throw rejects it), then the handler's answer is returned. */
export async function sendUpdate<T>(def: Def, ...args: unknown[]): Promise<T> {
  const handler = runtime.handlers.get(def.name);
  if (!handler) throw new Error(`no handler for ${def.name}`);
  const validator = runtime.validators.get(def.name);
  if (validator) call(validator, args);
  const pending = Promise.resolve(call(handler, args));
  poke();
  schedulePoke();
  return (await pending) as T;
}

export function runQuery<T>(def: Def): T {
  const handler = runtime.handlers.get(def.name);
  if (!handler) throw new Error(`no handler for ${def.name}`);
  return call(handler, []) as T;
}

/** Lets pending promise continuations (and timers set to 0) run. */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

/** Waits, in small steps, until `check` is true; fails the test with `what` otherwise. */
export async function waitFor(what: string, check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

/** Fires the first pending timer of `ms` milliseconds (manual time only). */
export function fireTimer(ms: number): void {
  const index = runtime.timers.findIndex((t) => t.ms === ms);
  const timer = runtime.timers[index];
  if (timer === undefined) {
    throw new Error(`no pending timer of ${ms} ms (pending: ${runtime.timers.map((t) => t.ms).join(', ')})`);
  }
  runtime.timers.splice(index, 1);
  timer.fire();
  schedulePoke();
}

export const pendingTimers = (): number[] => runtime.timers.map((t) => t.ms);

export const defineSignal = (name: string): Def => ({ name });
export const defineQuery = (name: string): Def => ({ name });
export const defineUpdate = (name: string): Def => ({ name });
export const setHandler = (def: Def, handler: Fn, options?: HandlerOptions): void => {
  runtime.handlers.set(def.name, handler);
  if (options?.validator) runtime.validators.set(def.name, options.validator);
};

export const patched = (name: string): boolean => !runtime.unpatched.has(name);
export const workflowInfo = (): { historyLength: number } => ({ historyLength: runtime.historyLength });
export const log = {
  info: (msg: string): void => void runtime.logs.push(`info ${msg}`),
  warn: (msg: string): void => void runtime.logs.push(`warn ${msg}`),
  error: (msg: string): void => void runtime.logs.push(`error ${msg}`),
};

export function proxyActivities(): Record<string, Fn> {
  return new Proxy(
    {},
    {
      get:
        (_target, name) =>
        (...args: unknown[]) => {
          const scope = scopes.getStore();
          if (scope?.isCancelled) return Promise.reject(new FakeCancelled('cancelled'));
          const fn = typeof name === 'string' ? runtime.activities[name] : undefined;
          if (!fn) return Promise.reject(new Error(`activity ${String(name)} is not stubbed`));
          return new Promise((resolve, reject) => {
            const off = onCancel(() => reject(new FakeCancelled('cancelled')));
            Promise.resolve()
              .then(() => call(fn, args))
              .then(resolve, reject)
              .finally(() => {
                off();
                schedulePoke();
              });
          });
        },
    },
  );
}

export function sleep(ms: number): Promise<void> {
  runtime.sleeps.push(ms);
  if (!runtime.manualTime) return Promise.resolve();
  const scope = scopes.getStore();
  if (scope?.isCancelled) return Promise.reject(new FakeCancelled('cancelled'));
  return new Promise<void>((resolve, reject) => {
    const timer: Timer = {
      ms,
      fire: () => {
        off();
        resolve();
      },
    };
    const off = onCancel(() => {
      runtime.timers = runtime.timers.filter((t) => t !== timer);
      reject(new FakeCancelled('cancelled'));
    });
    runtime.timers.push(timer);
  });
}

export function condition(predicate: () => boolean, timeoutMs?: number): Promise<boolean> {
  if (predicate()) return Promise.resolve(true);
  const scope = scopes.getStore();
  if (scope?.isCancelled) return Promise.reject(new FakeCancelled('cancelled'));
  return new Promise<boolean>((resolve, reject) => {
    const waiter: Waiter = { predicate, settle: resolve, off: () => undefined, timer: undefined };
    const stopListening = onCancel(() => {
      waiter.off();
      runtime.waiters.delete(waiter);
      reject(new FakeCancelled('cancelled'));
    });
    const dropTimer = (): void => {
      if (waiter.timer === undefined) return;
      const t = waiter.timer;
      runtime.timers = runtime.timers.filter((x) => x !== t);
    };
    let realTimer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      const timedOut = (): void => {
        runtime.waiters.delete(waiter);
        stopListening();
        resolve(false);
      };
      if (runtime.manualTime && timeoutMs > 0) {
        waiter.timer = { ms: timeoutMs, fire: timedOut };
        runtime.timers.push(waiter.timer);
      } else {
        realTimer = setTimeout(timedOut, timeoutMs);
      }
    }
    waiter.off = () => {
      stopListening();
      dropTimer();
      if (realTimer !== undefined) clearTimeout(realTimer);
    };
    runtime.waiters.add(waiter);
  });
}

export const ActivityCancellationType = { WAIT_CANCELLATION_COMPLETED: 'WAIT_CANCELLATION_COMPLETED' } as const;
export const isCancellation = (err: unknown): boolean => err instanceof FakeCancelled;

export class CancellationScope {
  private parent: CancellationScope | undefined;
  private readonly children = new Set<CancellationScope>();
  private readonly listeners = new Set<() => void>();
  private flag = false;
  private rejectCancel: ((err: Error) => void) | undefined;
  private readonly cancelled = new Promise<never>((_, reject) => {
    this.rejectCancel = reject;
  });
  constructor() {
    // The race in `run` is the only consumer; keep an unraced cancel from being an unhandled rejection.
    this.cancelled.catch(() => undefined);
  }
  get isCancelled(): boolean {
    return this.flag || (this.parent?.isCancelled ?? false);
  }
  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.parent = scopes.getStore();
    this.parent?.children.add(this);
    if (this.parent?.isCancelled) this.cancel();
    return scopes.run(this, () => Promise.race([fn(), this.cancelled]));
  }
  cancel(): void {
    if (this.flag) return;
    this.flag = true;
    this.rejectCancel?.(new FakeCancelled('cancelled'));
    for (const listener of [...this.listeners]) listener();
    for (const child of [...this.children]) child.cancel();
    schedulePoke();
  }
  static nonCancellable<T>(fn: () => Promise<T>): Promise<T> {
    return scopes.run(new CancellationScope(), fn);
  }
}

export function getExternalWorkflowHandle(id: string): { signal: (def: Def, ...args: unknown[]) => Promise<void> } {
  return {
    signal: (def, ...args) => {
      if (runtime.externalGone.has(id)) return Promise.reject(new Error('workflow not found'));
      runtime.externalSignals.push([`${id}:${def.name}`, ...(args.length > 0 ? [args.join(',')] : [])].join(':'));
      return Promise.resolve();
    },
  };
}

export function continueAsNew(...args: unknown[]): Promise<never> {
  return Promise.reject(new FakeContinueAsNew(args));
}
