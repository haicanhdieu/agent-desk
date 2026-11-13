import { ApplicationFailure } from '@temporalio/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { Provider } from '@agentdesk/contracts';
import {
  SetupLogTracker,
  buildSetupTestJob,
  runPodConfigFrom,
  setupTestJobName,
  setupTestLabels,
  toAdapterProject,
  type AdapterRegistry,
  type Clock,
  type Config,
  type KubeGateway,
} from '@agentdesk/core';
import { connections, projects, setupTestEvents, setupTests, withOrg, type Db } from '@agentdesk/db';
import { CLONE_URL_KEY, MIN_SECRET_LENGTH, guarded, oneLine, safeError, secretValues, sleep } from './activity-utils';
import { followPodLog, outputBudget } from './follow-core';
import { appendSetupTestEvent, storeSetupLineEvent } from './setup-test-events';
import type { SetupTestActivities, SetupTestRef, SetupTestResult } from './setup-test.activities';

export type SetupTestActivityConfig = Pick<
  Config,
  | 'RUNNER_IMAGE'
  | 'BOT_NAME'
  | 'BOT_EMAIL'
  | 'RUN_PLUGIN_MARKETPLACES'
  | 'RUN_SETUP_TIMEOUT_SECONDS'
  | 'SETUP_TEST_TTL_SECONDS'
  | 'RUN_POD_CPU_REQUEST'
  | 'RUN_POD_CPU_LIMIT'
  | 'RUN_POD_MEMORY_REQUEST'
  | 'RUN_POD_MEMORY_LIMIT'
  | 'RUN_POD_EPHEMERAL_STORAGE_LIMIT'
  | 'RUN_POD_WORKSPACE_SIZE_LIMIT'
  | 'RUN_POD_NODE_SELECTOR'
  | 'RUN_POD_TOLERATIONS'
  | 'RUN_POD_RUNTIME_CLASS'
>;

export interface SetupTestActivityTiming {
  /** Pod Pending limit (same as runs: 2 min). */
  pendingLimitMs?: number;
  pollMs?: number;
  /** followSetupTestLogs heartbeat interval. */
  heartbeatMs?: number;
}

export interface SetupTestActivityDeps {
  db: Db;
  kube: KubeGateway;
  adapters: AdapterRegistry;
  clock: Clock;
  config: SetupTestActivityConfig;
  timing?: SetupTestActivityTiming;
}

const PENDING_LIMIT_MS = 2 * 60 * 1000;
const POLL_MS = 1000;
const HEARTBEAT_MS = 10_000;

/** The runner's marker lines that carry setup state (the tracker emits each of these as an `event` effect). */
const MARKER_KINDS = [
  'checkout',
  'plugins_begin',
  'plugin_installed',
  'plugin_skipped',
  'plugin_failed',
  'plugins_end',
  'setup_begin',
  'setup_skipped',
  'setup_passed',
  'setup_failed',
  'setup_timed_out',
] as const;
/** The markers that end setup: the first one seen is the test's result. */
const RESULT_KINDS: ReadonlySet<string> = new Set(['setup_skipped', 'setup_passed', 'setup_failed', 'setup_timed_out']);

const MarkerPayload = z.object({
  kind: z.enum(MARKER_KINDS),
  text: z.string(),
  pluginId: z.string().optional(),
  exitCode: z.number().int().optional(),
  sha: z.string().optional(),
});

const isLive = (status: string): boolean => status === 'queued' || status === 'running';

export function createSetupTestActivities(deps: SetupTestActivityDeps): SetupTestActivities {
  const { db, kube, clock } = deps;
  const pendingLimitMs = deps.timing?.pendingLimitMs ?? PENDING_LIMIT_MS;
  const pollMs = deps.timing?.pollMs ?? POLL_MS;
  const heartbeatMs = deps.timing?.heartbeatMs ?? HEARTBEAT_MS;
  const ttlSeconds = deps.config.SETUP_TEST_TTL_SECONDS;

  // ---- createSetupTestJob

  async function createSetupTestJob(ref: SetupTestRef): Promise<{ ttlSeconds: number }> {
    const row = await withOrg(db, ref.orgId, async (tx) => {
      const [r] = await tx
        .select({
          status: setupTests.status,
          endedAt: setupTests.endedAt,
          projectId: setupTests.projectId,
          script: setupTests.scriptBody,
          repoPath: projects.repoPath,
          defaultBranch: projects.defaultBranch,
          codeProvider: connections.provider,
          codeExternalId: connections.externalId,
        })
        .from(setupTests)
        .innerJoin(projects, eq(projects.id, setupTests.projectId))
        .innerJoin(connections, eq(connections.id, projects.codeConnectionId))
        .where(eq(setupTests.id, ref.setupTestId));
      return r;
    });
    if (!row) throw ApplicationFailure.nonRetryable('setup test not found');
    // Ended (or already finished) while the workflow was starting: nothing to create, and no token to mint.
    if (row.endedAt !== null || !isLive(row.status)) return { ttlSeconds };
    if (!row.defaultBranch) throw ApplicationFailure.nonRetryable('the project has no default branch to check out');
    const parsedProvider = Provider.safeParse(row.codeProvider);
    if (!parsedProvider.success) {
      throw ApplicationFailure.nonRetryable(`unknown provider "${oneLine(row.codeProvider).slice(0, 40)}"`);
    }
    const script = row.script ?? '';
    const name = setupTestJobName(ref.setupTestId);
    const project = toAdapterProject(row, row.codeExternalId);
    // Redaction list for any error below: the script is untrusted text and must not leak through one either.
    let known = script.length >= MIN_SECRET_LENGTH ? [script] : [];
    try {
      const codeHost = deps.adapters.codeHost(parsedProvider.data);
      // The token stays inside this activity: it goes into the test Secret and nowhere else (ruling R19).
      const { token } = await codeHost.mintWorkspaceToken(project);
      known = [...known, token];
      const cloneUrl = codeHost.cloneUrl(project, token);
      known = [...known, ...secretValues({ cloneUrl })];
      const labels = setupTestLabels({
        setupTestId: ref.setupTestId,
        orgId: ref.orgId,
        projectId: row.projectId,
      });
      // Clone URL and the adapter's env only: a setup test never gets the agent credential.
      await kube.ensureSecret(name, { [CLONE_URL_KEY]: cloneUrl, ...codeHost.runEnv(token) }, labels);
      const job = buildSetupTestJob({
        setupTestId: ref.setupTestId,
        orgId: ref.orgId,
        projectId: row.projectId,
        image: deps.config.RUNNER_IMAGE,
        checkoutRef: row.defaultBranch,
        script,
        pluginMarketplaces: deps.config.RUN_PLUGIN_MARKETPLACES,
        setupTimeoutSeconds: deps.config.RUN_SETUP_TIMEOUT_SECONDS,
        ttlSeconds,
        botName: deps.config.BOT_NAME,
        botEmail: deps.config.BOT_EMAIL,
        pod: runPodConfigFrom(deps.config),
      });
      try {
        await kube.ensureJob(job);
      } catch (err) {
        // Do not leave a Secret with a live token behind; the next attempt recreates it with a fresh token.
        await kube.deleteSecret(name).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      throw safeError(err, known, 'create setup test Job');
    }
    await withOrg(db, ref.orgId, async (tx) => {
      const moved = await tx
        .update(setupTests)
        .set({ status: 'running' })
        .where(and(eq(setupTests.id, ref.setupTestId), eq(setupTests.status, 'queued')))
        .returning({ id: setupTests.id });
      if (moved.length > 0) {
        await appendSetupTestEvent(tx, ref.orgId, {
          setupTestId: ref.setupTestId,
          type: 'status',
          payload: { status: 'running' },
        });
      }
    });
    return { ttlSeconds };
  }

  // ---- followSetupTestLogs

  /** Values to redact from output; fails closed like the run path (a read error propagates, retryable). */
  async function redactionList(ref: SetupTestRef): Promise<string[]> {
    return secretValues(await kube.readSecret(setupTestJobName(ref.setupTestId)));
  }

  async function currentResult(ref: SetupTestRef): Promise<{ status: string; ended: boolean } | null> {
    const row = await withOrg(db, ref.orgId, async (tx) => {
      const [r] = await tx
        .select({ status: setupTests.status, endedAt: setupTests.endedAt })
        .from(setupTests)
        .where(eq(setupTests.id, ref.setupTestId));
      return r;
    });
    return row ? { status: row.status, ended: row.endedAt !== null } : null;
  }

  /** Output already stored for the test (all passes and attempts): characters spent and whether it was truncated. */
  async function storedOutputBudget(ref: SetupTestRef): Promise<{ chars: number; truncated: boolean }> {
    const rows = await withOrg(db, ref.orgId, (tx) =>
      tx
        .select({ payload: setupTestEvents.payload })
        .from(setupTestEvents)
        .where(
          and(
            eq(setupTestEvents.setupTestId, ref.setupTestId),
            eq(setupTestEvents.type, 'lifecycle'),
            sql`${setupTestEvents.payload} ->> 'kind' in ('setup_output', 'plugin_output')`,
          ),
        ),
    );
    return outputBudget(rows.map((r) => r.payload));
  }

  /**
   * The checkout sha, plugin lists and setup outcome, rebuilt from the stored marker events (not from this attempt's
   * memory), so a retry that skipped already-durable lines still reports everything.
   */
  async function storedSummary(ref: SetupTestRef): Promise<SetupLogTracker['summary']> {
    const rows = await withOrg(db, ref.orgId, (tx) =>
      tx
        .select({ payload: setupTestEvents.payload })
        .from(setupTestEvents)
        .where(
          and(
            eq(setupTestEvents.setupTestId, ref.setupTestId),
            eq(setupTestEvents.type, 'lifecycle'),
            inArray(sql`${setupTestEvents.payload} ->> 'kind'`, [...MARKER_KINDS]),
          ),
        )
        .orderBy(setupTestEvents.seq),
    );
    const tracker = new SetupLogTracker({ chunkLines: 1, maxChars: 1 });
    for (const r of rows) {
      const p = MarkerPayload.safeParse(r.payload);
      if (!p.success) continue;
      tracker.push({
        kind: p.data.kind,
        text: p.data.text,
        ...(p.data.pluginId !== undefined ? { pluginId: p.data.pluginId } : {}),
        ...(p.data.exitCode !== undefined ? { exitCode: p.data.exitCode } : {}),
        ...(p.data.sha !== undefined ? { sha: p.data.sha } : {}),
      });
    }
    return tracker.summary;
  }

  /** Writes the result once (only while the test is still queued/running; a finished or ended test is left alone). */
  async function recordResult(ref: SetupTestRef): Promise<SetupTestResult> {
    const summary = await storedSummary(ref);
    const passed = summary.setup === 'passed' || summary.setup === 'skipped';
    const failed = summary.setup === 'failed' || summary.setup === 'timed_out';
    if (!passed && !failed) return null;
    const status = passed ? 'passed' : 'failed';
    await withOrg(db, ref.orgId, async (tx) => {
      const moved = await tx
        .update(setupTests)
        .set({
          status,
          exitCode: summary.exitCode,
          checkoutSha: summary.checkoutSha,
          plugins: summary.plugins,
          finishedAt: clock.now(),
        })
        .where(and(eq(setupTests.id, ref.setupTestId), inArray(setupTests.status, ['queued', 'running'])))
        .returning({ id: setupTests.id });
      if (moved.length > 0) {
        await appendSetupTestEvent(tx, ref.orgId, {
          setupTestId: ref.setupTestId,
          type: 'status',
          payload: { status },
        });
      }
    });
    const after = await currentResult(ref);
    return after && (after.status === 'passed' || after.status === 'failed') ? { status: after.status } : null;
  }

  async function followSetupTestLogs(ref: SetupTestRef): Promise<SetupTestResult> {
    const start = await currentResult(ref);
    if (!start) throw ApplicationFailure.nonRetryable('setup test not found');
    if (start.status === 'passed' || start.status === 'failed') return { status: start.status };
    if (start.ended) return null;

    return followPodLog<SetupTestResult>(
      { kube, clock, pendingLimitMs, pollMs, heartbeatMs },
      {
        what: 'follow setup test logs',
        jobName: setupTestJobName(ref.setupTestId),
        secrets: () => redactionList(ref),
        storedBudget: () => storedOutputBudget(ref),
        storeLifecycle: async (line, payload) => {
          await withOrg(db, ref.orgId, (tx) => storeSetupLineEvent(tx, ref.orgId, ref.setupTestId, line, payload));
        },
        onParsed: async (pass, parsed) => {
          if (!RESULT_KINDS.has(parsed.kind)) return undefined;
          // Durable only once the result is written: a retry must see this marker again if the write failed.
          const result = await recordResult(ref);
          if (!result) return undefined;
          pass.markDurable(pass.index);
          pass.beat();
          return { done: result };
        },
        afterStream: async (pass) => {
          await pass.throwIfCancelled();
          const pod = await kube.getRunPod(setupTestJobName(ref.setupTestId));
          // The log stream dropped while the container still runs: re-attach.
          if (pod && pod.exitCode === null && pod.phase === 'Running') {
            await sleep(pollMs, pass.signal);
            await pass.throwIfCancelled();
            return 'reattach';
          }
          // The pod ended without a result marker: keep what it printed; finalize ends the test.
          await pass.flushPending();
          pass.markDurable(pass.index);
          pass.beat();
          return { done: null };
        },
      },
    );
  }

  // ---- finalizeSetupTest

  async function finalizeSetupTest(ref: SetupTestRef): Promise<void> {
    // The database first: `ended_at` marks the Job and Secret for reconcile even if the deletes below keep failing.
    await withOrg(db, ref.orgId, async (tx) => {
      const [cur] = await tx
        .select({ status: setupTests.status })
        .from(setupTests)
        .where(eq(setupTests.id, ref.setupTestId))
        .for('update');
      if (!cur) return;
      const ending = isLive(cur.status);
      await tx
        .update(setupTests)
        .set({
          scriptBody: null,
          endedAt: sql`coalesce(${setupTests.endedAt}, ${clock.now().toISOString()}::timestamptz)`,
          ...(ending ? { status: 'ended' } : {}),
        })
        .where(eq(setupTests.id, ref.setupTestId));
      if (ending) {
        await appendSetupTestEvent(tx, ref.orgId, {
          setupTestId: ref.setupTestId,
          type: 'status',
          payload: { status: 'ended' },
        });
      }
    });
    const name = setupTestJobName(ref.setupTestId);
    await kube.deleteJob(name);
    await kube.deleteSecret(name);
  }

  return {
    createSetupTestJob: guarded('create setup test Job', createSetupTestJob),
    followSetupTestLogs: guarded('follow setup test logs', followSetupTestLogs),
    finalizeSetupTest: guarded('finalize setup test', finalizeSetupTest),
  };
}
