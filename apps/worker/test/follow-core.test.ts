import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { MockActivityEnvironment } from '@temporalio/testing';
import { ApiException } from '@kubernetes/client-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLUSTER_PERMANENT_ERROR,
  createAdapterRegistry,
  parseConfig,
  type KubeGateway,
  type RunPod,
} from '@agentdesk/core';
import { createDb, type Tx } from '@agentdesk/db';
import {
  REDACTION_EXTRA_KEEP,
  REDACTION_REFRESH_MS,
  ContactLostError,
  appendSeqEvent,
  createReconnector,
  createSecretAccumulator,
  followPodLog,
  outputBudget,
  waitForPod,
  type ContactEvents,
  type FollowHooks,
} from '../src/activities/follow-core';
import { POD_PENDING_TIMEOUT } from '../src/activities/run.activities';
import { createRunActivities } from '../src/activities/run.activities.impl';

const pod = (phase: RunPod['phase'], pendingSince: Date | null = null): RunPod => ({
  name: 'p',
  phase,
  pendingSince,
  reason: phase === 'Pending' ? 'Unschedulable' : null,
  exitCode: null,
});

function kubeWith(over: Partial<KubeGateway>): KubeGateway {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  return {
    ensureSecret: unused,
    replaceSecretData: unused,
    readSecret: async () => null,
    deleteSecret: unused,
    ensureJob: unused,
    getRunPod: async () => null,
    streamLogs: () => ({ [Symbol.asyncIterator]: () => ({ next: unused }) }),
    exec: unused,
    deleteJob: unused,
    listRunJobs: unused,
    listSetupTestJobs: unused,
    listRunSecrets: unused,
    listSetupTestSecrets: unused,
    ensureVolumeClaim: unused,
    deleteVolumeClaim: unused,
    listRunVolumeClaims: async () => [],
    ...over,
  };
}

describe('waitForPod (shared by runs and setup tests)', () => {
  const clock = { now: () => new Date() };
  const timing = { pendingLimitMs: 40, pollMs: 5, heartbeatMs: 1000, reconnectWindowMs: 1000 };

  it('returns a started pod', async () => {
    const kube = kubeWith({ getRunPod: async () => pod('Running') });
    expect((await waitForPod({ kube, clock, ...timing }, 'job', new AbortController().signal)).phase).toBe('Running');
  });

  it('throws the typed, non-retryable POD_PENDING_TIMEOUT after the limit (pending, or no pod at all)', async () => {
    for (const got of [pod('Pending', new Date(Date.now() - 1000)), null]) {
      const kube = kubeWith({ getRunPod: async () => got });
      const err = await waitForPod({ kube, clock, ...timing }, 'job', new AbortController().signal).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe(POD_PENDING_TIMEOUT);
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
  });

  it('is cancellable', async () => {
    const kube = kubeWith({ getRunPod: async () => pod('Pending', new Date()) });
    const ac = new AbortController();
    ac.abort();
    await expect(waitForPod({ kube, clock, ...timing }, 'job', ac.signal)).rejects.toBeInstanceOf(CancelledFailure);
  });
});

describe('run followPodLogs pending limit', () => {
  it('throws POD_PENDING_TIMEOUT like the setup-test follower', async () => {
    const config = parseConfig({
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:5173',
      DATABASE_APP_URL: 'x',
      DATABASE_OWNER_URL: 'x',
      DATABASE_ADMIN_URL: 'x',
      TEMPORAL_ADDRESS: 'x',
      TEMPORAL_NAMESPACE: 'default',
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      RUNNER_IMAGE: 'img',
      ENABLE_FAKE_PROVIDER: 'true',
      FAKE_STATE_DIR: 'unused',
    });
    // The pool is lazy: nothing before the pod wait touches the database.
    const db = createDb('postgres://nobody@127.0.0.1:1/none');
    try {
      const acts = createRunActivities({
        db,
        kube: kubeWith({ getRunPod: async () => null }),
        adapters: createAdapterRegistry(config, { now: () => new Date() }),
        secrets: { get: async () => null, put: async () => undefined, delete: async () => undefined },
        signaller: { signalRun: async () => undefined },
        clock: { now: () => new Date() },
        config,
        timing: { pendingLimitMs: 30, pollMs: 5, heartbeatMs: 1000 },
      });
      const ctx = {
        orgId: '44444444-4444-4444-8444-444444444444',
        runId: '55555555-5555-4555-8555-555555555555',
        projectId: '66666666-6666-4666-8666-666666666666',
        agentId: null,
        status: 'starting' as const,
        timeoutSeconds: 60,
        maxConcurrentRuns: 1,
      };
      const err = await new MockActivityEnvironment().run(acts.followPodLogs, ctx).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe(POD_PENDING_TIMEOUT);
    } finally {
      await db.close();
    }
  });
});

describe('followPodLog bookkeeping (chunk keys and durable line)', () => {
  it('keys markers by their own line and output chunks by their last line; durable never passes buffered output', async () => {
    const lines = [
      'agentdesk: plugins begin', // 1 marker
      'setup| a', // 2 buffered
      'setup| b', // 3 buffered
      'agentdesk: setup begin', // 4 flushes the chunk (keyed 3), then the marker (keyed 4)
      'setup| c', // 5 buffered, flushed at the end of the stream
    ];
    const stored: { line: number; kind: unknown; text: unknown }[] = [];
    const beats: number[] = [];
    const kube = kubeWith({
      getRunPod: async () => pod('Running'),
      async *streamLogs() {
        for (const l of lines) yield l;
      },
    });
    const hooks: FollowHooks<string> = {
      what: 'test follow',
      jobName: 'job',
      secrets: async () => [],
      storedBudget: async () => ({ chars: 0, truncated: false }),
      storeLifecycle: async (line, payload) => void stored.push({ line, kind: payload.kind, text: payload.text }),
      onContactLost: async () => ({ done: 'parked' }),
      afterStream: async (pass) => {
        await pass.flushPending();
        pass.markDurable(pass.index);
        pass.beat();
        return { done: 'finished' };
      },
    };
    const env = new MockActivityEnvironment();
    env.on('heartbeat', (b: unknown) => {
      if (typeof b === 'object' && b !== null && 'lastLine' in b && typeof b.lastLine === 'number') {
        beats.push(b.lastLine);
      }
    });
    const timing = {
      kube,
      clock: { now: () => new Date() },
      pollMs: 5,
      heartbeatMs: 1000,
      pendingLimitMs: 1000,
      reconnectWindowMs: 1000,
    };
    const out = await env.run(() => followPodLog(timing, hooks));
    expect(out).toBe('finished');
    expect(stored).toEqual([
      { line: 1, kind: 'plugins_begin', text: 'agentdesk: plugins begin' },
      { line: 3, kind: 'setup_output', text: 'a\nb' },
      { line: 4, kind: 'setup_begin', text: 'agentdesk: setup begin' },
      { line: 5, kind: 'setup_output', text: 'c' },
    ]);
    // Buffered output is not durable: the beat stays at the last stored line (1) until the marker flushes it (4).
    expect(beats).toEqual([0, 1, 1, 1, 4, 4, 5]);
  });
});

describe('followPodLog redaction refresh (rotated workspace token)', () => {
  const OLD = 'initial-tok-ABC987';
  const NEW = 'rotated-tok-XYZ123';

  /** Runs a follow over `steps`: a string is a log line, a function runs between lines (rotation, time passing). */
  const runFollow = async (opts: {
    secrets: (clockMs: number) => Promise<string[]>;
    steps: (adv: (ms: number) => void) => (string | (() => void))[];
    refreshMs?: number;
  }): Promise<string> => {
    let nowMs = 0;
    const stored: string[] = [];
    const steps = opts.steps((ms) => (nowMs += ms));
    const kube = kubeWith({
      getRunPod: async () => pod('Running'),
      async *streamLogs() {
        for (const step of steps) {
          if (typeof step === 'string') yield step;
          else step();
        }
      },
    });
    const hooks: FollowHooks<string> = {
      what: 'test follow',
      jobName: 'job',
      secrets: () => opts.secrets(nowMs),
      storedBudget: async () => ({ chars: 0, truncated: false }),
      storeLifecycle: async (_line, payload) => void stored.push(String(payload.text)),
      onContactLost: async () => ({ done: 'parked' }),
      afterStream: async (pass) => {
        await pass.flushPending();
        return { done: 'finished' };
      },
    };
    const env = {
      kube,
      clock: { now: () => new Date(nowMs) },
      pollMs: 5,
      heartbeatMs: 1000,
      pendingLimitMs: 1000,
      reconnectWindowMs: 1000,
      redactionRefreshMs: opts.refreshMs ?? 500,
    };
    await new MockActivityEnvironment().run(() => followPodLog(env, hooks));
    return stored.join('\n');
  };

  it('redacts a rotated token of any shape after the refresh interval, and still the old one', async () => {
    let current = OLD;
    const stored = await runFollow({
      secrets: async () => [current],
      steps: (adv) => [
        `setup| clone with ${OLD}`,
        () => {
          current = NEW; // the token is rotated in the run Secret mid-run
          adv(1000);
        },
        `setup| now ${NEW}`,
        `setup| stale ${OLD}`,
      ],
    });
    expect(stored).not.toContain(NEW);
    expect(stored).not.toContain(OLD);
    expect(stored).toContain('now ');
  });

  it('defaults to a re-read interval of at most 60 s, shorter than the pod token file sync', () => {
    expect(REDACTION_REFRESH_MS).toBeLessThanOrEqual(60_000);
  });

  it('redacts a token rotated between two re-reads on the first line after the next re-read', async () => {
    let current = OLD;
    const stored = await runFollow({
      refreshMs: REDACTION_REFRESH_MS,
      secrets: async () => [current],
      steps: (adv) => [
        `setup| clone with ${OLD}`,
        () => {
          adv(10_000);
          current = NEW; // rotated mid-interval, before the next re-read
          adv(REDACTION_REFRESH_MS - 10_000);
        },
        `setup| debug ${NEW}`,
      ],
    });
    expect(stored).not.toContain(NEW);
    expect(stored).not.toContain(OLD);
    expect(stored).toContain('debug ');
  });

  it('keeps the last good list when a refresh fails, without leaking or failing the follow', async () => {
    let calls = 0;
    const stored = await runFollow({
      secrets: async () => {
        calls += 1;
        if (calls > 1) throw new Error(`boom ${OLD}`);
        return [OLD];
      },
      steps: (adv) => [() => adv(1000), `setup| ${OLD}`],
    });
    expect(calls).toBeGreaterThan(1);
    expect(stored).not.toContain(OLD);
  });
});

describe('createSecretAccumulator', () => {
  it('keeps first-read values and the newest extras, bounded over many rotations', () => {
    const acc = createSecretAccumulator();
    let list = acc.merge(['credential-value', 'token-0']);
    for (let i = 1; i <= 50; i++) {
      list = acc.merge(['credential-value', `token-${i}`]);
      expect(list.length).toBeLessThanOrEqual(2 + REDACTION_EXTRA_KEEP);
    }
    expect(list).toContain('credential-value');
    expect(list).toContain('token-0');
    expect(list).toContain('token-50');
    expect(list).toContain(`token-${50 - REDACTION_EXTRA_KEEP + 1}`);
    expect(list).not.toContain('token-1');
    expect(list).not.toContain(`token-${50 - REDACTION_EXTRA_KEEP}`);
  });

  it('dedupes and keeps the list on a repeated read', () => {
    const acc = createSecretAccumulator();
    expect(acc.merge(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(acc.merge(['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(acc.merge(['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('appendSeqEvent', () => {
  // The table fakes never touch the transaction; only their call order and the seq they are given matter.
  const tx: Tx = Object.create(null);

  it('inserts the next seq after locking the owner', async () => {
    const calls: string[] = [];
    const result = await appendSeqEvent(tx, {
      lockOwner: async () => {
        calls.push('lock');
        return true;
      },
      maxSeq: async () => {
        calls.push('max');
        return 4;
      },
      insert: async (_tx, seq) => {
        calls.push(`insert:${seq}`);
      },
    });
    expect(result).toEqual({ seq: 5 });
    expect(calls).toEqual(['lock', 'max', 'insert:5']);
  });

  it('returns null and writes nothing when the owner does not exist', async () => {
    const calls: string[] = [];
    const result = await appendSeqEvent(tx, {
      lockOwner: async () => false,
      maxSeq: async () => {
        calls.push('max');
        return 0;
      },
      insert: async () => {
        calls.push('insert');
      },
    });
    expect(result).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('outputBudget', () => {
  it('sums stored text (plus a newline each), skips malformed payloads and remembers truncation', () => {
    expect(outputBudget([])).toEqual({ chars: 0, truncated: false });
    expect(outputBudget([{ text: 'abc' }, { nope: 1 }, 'junk', { text: 'de', truncated: false }])).toEqual({
      chars: 4 + 3,
      truncated: false,
    });
    expect(outputBudget([{ text: 'abc', truncated: true }, { text: '' }])).toEqual({ chars: 4 + 1, truncated: true });
  });
});

describe('reconnect', () => {
  afterEach(() => vi.useRealTimers());

  const fetchFailed = (): TypeError => new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
  const bad = (status: number): ApiException<undefined> => new ApiException(status, 'x', undefined, {});
  const clock = { now: () => new Date() };

  function contactLog(failEvents = 0): { events: string[]; contact: ContactEvents; failures: { left: number } } {
    const events: string[] = [];
    const failures = { left: failEvents };
    const send = async (e: string): Promise<void> => {
      if (failures.left > 0) {
        failures.left -= 1;
        throw new Error('db down');
      }
      events.push(e);
    };
    return {
      events,
      failures,
      contact: { lost: (cause) => send(`lost:${cause}`), restored: () => send('restored') },
    };
  }

  function hooksFor(over: Partial<FollowHooks<string>> = {}, stored: number[] = []): FollowHooks<string> {
    return {
      what: 'test follow',
      jobName: 'job',
      secrets: async () => [],
      storedBudget: async () => ({ chars: 0, truncated: false }),
      storeLifecycle: async (line) => void stored.push(line),
      afterStream: async (pass) => {
        pass.markDurable(pass.index);
        return { done: 'finished' };
      },
      onContactLost: async () => ({ done: 'parked' }),
      ...over,
    };
  }

  const envFor = (kube: KubeGateway, over: Record<string, unknown> = {}) => ({
    kube,
    clock,
    pollMs: 5,
    heartbeatMs: 100_000,
    pendingLimitMs: 1000,
    reconnectWindowMs: 30 * 60_000,
    ...over,
  });

  it('recovers from failing stream opens and getRunPod calls without duplicate lines, one event pair per outage', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let runPodCalls = 0;
    let opens = 0;
    const kube = kubeWith({
      getRunPod: async () => {
        runPodCalls += 1;
        if (runPodCalls <= 3) throw bad(502);
        return pod('Running');
      },
      async *streamLogs() {
        opens += 1;
        if (opens <= 3) throw fetchFailed();
        yield 'agentdesk: plugins begin';
        if (opens === 4) throw fetchFailed();
        yield 'agentdesk: setup begin';
      },
    });
    const log = contactLog();
    const stored: number[] = [];
    const beats: unknown[] = [];
    const env = new MockActivityEnvironment();
    env.on('heartbeat', (b: unknown) => void beats.push(b));
    const run = env.run(() => followPodLog(envFor(kube), hooksFor({ contact: log.contact }, stored)));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await run).toBe('finished');
    expect(stored).toEqual([1, 2]);
    // gRP outage (3 fails), stream-open outage (3 fails), then a mid-stream break: each outage is one pair.
    expect(log.events.filter((e) => e.startsWith('lost:')).length).toBe(
      log.events.filter((e) => e === 'restored').length,
    );
    expect(log.events[0]).toBe('lost:http_502');
    expect(log.events.filter((e) => e === 'lost:http_502')).toHaveLength(1);
    expect(beats.some((b) => typeof b === 'object' && b !== null && 'lostSinceMs' in b)).toBe(true);
  });

  it('past reconnectWindowMs, hooks.onContactLost is called and its result returned', async () => {
    const kube = kubeWith({
      getRunPod: async () => {
        throw bad(503);
      },
    });
    const out = await new MockActivityEnvironment().run(() =>
      followPodLog(envFor(kube, { reconnectWindowMs: 30 }), hooksFor()),
    );
    expect(out).toBe('parked');
  });

  it('a 403 from getRunPod is a non-retryable ClusterPermanentError with no backoff', async () => {
    let calls = 0;
    const kube = kubeWith({
      getRunPod: async () => {
        calls += 1;
        throw bad(403);
      },
    });
    const err = await new MockActivityEnvironment()
      .run(() => followPodLog(envFor(kube), hooksFor()))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).type).toBe(CLUSTER_PERMANENT_ERROR);
    expect((err as ApplicationFailure).nonRetryable).toBe(true);
    expect(calls).toBe(1);
  });

  it('heartbeat restore: no second lost event, and the window counts from the first loss', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const lostSinceMs = Date.now() - 10 * 60_000;
    const kube = kubeWith({
      getRunPod: async () => {
        throw bad(503);
      },
    });
    const log = contactLog();
    const env = new MockActivityEnvironment({ heartbeatDetails: { lastLine: 5, lostSinceMs } });
    const startedAt = Date.now();
    let endedAt = 0;
    // The cluster is still down after the restart, so the first secrets() read fails too.
    const secrets = async (): Promise<string[]> => {
      throw bad(503);
    };
    const run = env
      .run(() => followPodLog(envFor(kube), hooksFor({ contact: log.contact, secrets })))
      .finally(() => void (endedAt = Date.now()));
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(await run).toBe('parked');
    expect(log.events).toEqual([]);
    const elapsed = endedAt - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(20 * 60_000 - 1000);
    expect(elapsed).toBeLessThan(21 * 60_000);
  });

  it('heartbeat restore with a still-failing stream: getRunPod answering does not close the outage', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const lostSinceMs = Date.now() - 10 * 60_000;
    const kube = kubeWith({
      getRunPod: async () => pod('Running'),
      // eslint-disable-next-line require-yield
      async *streamLogs() {
        throw fetchFailed();
      },
    });
    const log = contactLog();
    const startedAt = Date.now();
    let endedAt = 0;
    const run = new MockActivityEnvironment({ heartbeatDetails: { lastLine: 0, lostSinceMs } })
      .run(() => followPodLog(envFor(kube), hooksFor({ contact: log.contact })))
      .finally(() => void (endedAt = Date.now()));
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(await run).toBe('parked');
    expect(log.events).toEqual([]);
    expect(endedAt - startedAt).toBeGreaterThanOrEqual(20 * 60_000 - 1000);
    expect(endedAt - startedAt).toBeLessThan(21 * 60_000);
  });

  it('a failing event write does not end the follower; it is retried and sent once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let calls = 0;
    const kube = kubeWith({
      getRunPod: async () => {
        calls += 1;
        if (calls <= 3) throw bad(503);
        return pod('Running');
      },
      async *streamLogs() {
        yield 'agentdesk: plugins begin';
      },
    });
    const log = contactLog(2); // the first two event writes fail
    const run = new MockActivityEnvironment().run(() => followPodLog(envFor(kube), hooksFor({ contact: log.contact })));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await run).toBe('finished');
    expect(log.events).toEqual(['lost:http_503', 'restored']);
  });

  it('a stream that keeps failing while getRunPod answers Running parks after the window with one lost event', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let opens = 0;
    const kube = kubeWith({
      getRunPod: async () => pod('Running'),
      // eslint-disable-next-line require-yield
      async *streamLogs() {
        opens += 1;
        throw fetchFailed();
      },
    });
    const log = contactLog();
    const run = new MockActivityEnvironment().run(() => followPodLog(envFor(kube), hooksFor({ contact: log.contact })));
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(await run).toBe('parked');
    expect(log.events).toEqual(['lost:ECONNRESET']);
    expect(opens).toBeGreaterThan(10);
  });

  it('an error thrown by onContactLost is redacted like any follower error', async () => {
    const kube = kubeWith({
      getRunPod: async () => {
        throw bad(503);
      },
    });
    const err = await new MockActivityEnvironment()
      .run(() =>
        followPodLog(
          envFor(kube, { reconnectWindowMs: 30 }),
          hooksFor({
            secrets: async () => ['hunter2-token'],
            onContactLost: async () => {
              throw new Error('park failed for hunter2-token');
            },
          }),
        ),
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect((err as ApplicationFailure).message).not.toContain('hunter2-token');
  });

  it('a cancel during backoff ends with CancelledFailure within a poll, not after the cap', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const kube = kubeWith({
      getRunPod: async () => {
        throw bad(503);
      },
    });
    const env = new MockActivityEnvironment();
    const run = env.run(() => followPodLog(envFor(kube), hooksFor())).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(40_000); // deep into a backoff wait
    env.cancel();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await run).toBeInstanceOf(CancelledFailure);
  });

  it('the first secrets() read failing transiently waits and retries; it never follows without the list', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let reads = 0;
    let opens = 0;
    const kube = kubeWith({
      getRunPod: async () => pod('Running'),
      async *streamLogs() {
        opens += 1;
        yield 'agentdesk: plugins begin';
      },
    });
    const run = new MockActivityEnvironment().run(() =>
      followPodLog(
        envFor(kube),
        hooksFor({
          secrets: async () => {
            reads += 1;
            if (reads <= 2) throw fetchFailed();
            return ['s'];
          },
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await run).toBe('finished');
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(opens).toBe(1);
  });

  it('Running, then Unknown past the Pending limit gives no POD_PENDING_TIMEOUT when seenStarted', async () => {
    let calls = 0;
    const kube = kubeWith({
      getRunPod: async () => {
        calls += 1;
        return calls <= 8 ? pod('Unknown', new Date(Date.now() - 10_000)) : pod('Running');
      },
    });
    const cluster = createReconnector({
      clock,
      windowMs: 60_000,
      signal: new AbortController().signal,
      beat: () => undefined,
      lostSinceMs: null,
      random: () => 0,
    });
    const env = { kube, clock, pollMs: 5, heartbeatMs: 1000, pendingLimitMs: 40, reconnectWindowMs: 60_000 };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const got = waitForPod(env, 'job', new AbortController().signal, { cluster, seenStarted: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await got).phase).toBe('Running');
  });
});

describe('createReconnector backoff', () => {
  afterEach(() => vi.useRealTimers());

  it('doubles from 1 s to a 30 s cap with random = 1, and halves the floor with random = 0', async () => {
    for (const [random, expected] of [
      [() => 1, [1, 2, 4, 8, 16, 30, 30]],
      [() => 0, [0.5, 1, 2, 4, 8, 15, 15]],
    ] as const) {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const r = createReconnector({
        clock: { now: () => new Date() },
        windowMs: 60 * 60_000,
        signal: new AbortController().signal,
        beat: () => undefined,
        lostSinceMs: null,
        random,
      });
      const got: number[] = [];
      for (let i = 0; i < expected.length; i++) {
        let settled = false;
        const p = r.lost('x').then(() => void (settled = true));
        let ms = 0;
        while (!settled && ms < 40_000) {
          await vi.advanceTimersByTimeAsync(100);
          ms += 100;
        }
        await p;
        got.push(ms / 1000);
      }
      expect(got).toEqual(expected.map((s) => Math.ceil(s * 10) / 10));
      vi.useRealTimers();
    }
  });

  it('throws ContactLostError once the window has run out', async () => {
    const r = createReconnector({
      clock: { now: () => new Date() },
      windowMs: 20,
      signal: new AbortController().signal,
      beat: () => undefined,
      lostSinceMs: Date.now() - 100,
    });
    await expect(r.lost('x')).rejects.toBeInstanceOf(ContactLostError);
  });
});
