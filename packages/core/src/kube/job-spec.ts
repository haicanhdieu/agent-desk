import type { V1EnvVar, V1Job, V1Toleration } from '@kubernetes/client-node';
import type { Config } from '../config';
import { RUN_CONTAINER, RUN_LABELS, SETUP_TEST_KIND, SETUP_TEST_LABELS, runJobName, setupTestJobName } from './gateway';

/** Run pod settings from `RUN_POD_*` config (the infra chart supplies the values). */
export interface RunPodConfig {
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  ephemeralStorageLimit: string;
  workspaceSizeLimit: string;
  nodeSelector?: Record<string, string>;
  tolerations?: V1Toleration[];
  runtimeClassName?: string;
}

export interface RunJobInput {
  runId: string;
  orgId: string;
  projectId: string;
  image: string;
  /** Untrusted text (contains the comment's args): passed only as an env value. */
  prompt: string;
  checkoutRef: string;
  /** Key in the run Secret that holds the clone URL (with the workspace token); reaches the pod via `envFrom`. */
  cloneUrlSecretKey: string;
  maxTurns: number | null;
  timeoutSeconds: number;
  botName: string;
  botEmail: string;
  /** Approved plugin stores (store -> source) from platform config; reaches the pod as one JSON env value. */
  pluginMarketplaces: Record<string, string>;
  /** Cap on the repo setup script, from platform config. */
  setupTimeoutSeconds: number;
  /** The project's saved setup script (untrusted text): an env value only. Null or empty means none. */
  setupScript: string | null;
  pod: RunPodConfig;
}

/** Spec cap on `timeout_seconds` (the one-hour workspace token must outlive the run). */
const TIMEOUT_SECONDS_MAX = 3300;
/** `activeDeadlineSeconds` = timeout + this, a backstop to the workflow's hard timer. */
const DEADLINE_MARGIN_SECONDS = 120;
const TTL_AFTER_FINISHED_SECONDS = 3600;
const RUNNER_UID = 10001;

export function runLabels(input: { runId: string; orgId: string; projectId: string }): Record<string, string> {
  return {
    'app.kubernetes.io/managed-by': 'agentdesk',
    [RUN_LABELS.runId]: input.runId,
    [RUN_LABELS.projectId]: input.projectId,
    [RUN_LABELS.orgId]: input.orgId,
  };
}

export function runPodConfigFrom(
  c: Pick<
    Config,
    | 'RUN_POD_CPU_REQUEST'
    | 'RUN_POD_CPU_LIMIT'
    | 'RUN_POD_MEMORY_REQUEST'
    | 'RUN_POD_MEMORY_LIMIT'
    | 'RUN_POD_EPHEMERAL_STORAGE_LIMIT'
    | 'RUN_POD_WORKSPACE_SIZE_LIMIT'
    | 'RUN_POD_NODE_SELECTOR'
    | 'RUN_POD_TOLERATIONS'
    | 'RUN_POD_RUNTIME_CLASS'
  >,
): RunPodConfig {
  return {
    cpuRequest: c.RUN_POD_CPU_REQUEST,
    cpuLimit: c.RUN_POD_CPU_LIMIT,
    memoryRequest: c.RUN_POD_MEMORY_REQUEST,
    memoryLimit: c.RUN_POD_MEMORY_LIMIT,
    ephemeralStorageLimit: c.RUN_POD_EPHEMERAL_STORAGE_LIMIT,
    workspaceSizeLimit: c.RUN_POD_WORKSPACE_SIZE_LIMIT,
    ...(c.RUN_POD_NODE_SELECTOR ? { nodeSelector: c.RUN_POD_NODE_SELECTOR } : {}),
    ...(c.RUN_POD_TOLERATIONS ? { tolerations: c.RUN_POD_TOLERATIONS } : {}),
    ...(c.RUN_POD_RUNTIME_CLASS ? { runtimeClassName: c.RUN_POD_RUNTIME_CLASS } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, what: string): void {
  if (!UUID.test(value)) throw new Error(`invalid ${what} id`);
}

/**
 * The one place a sandbox Job's pod shape lives (security context, resources, volumes, scheduling), so run Jobs and
 * setup-test Jobs cannot drift. `name` is also the Secret that reaches the pod through `envFrom`.
 */
function podJob(o: {
  name: string;
  labels: Record<string, string>;
  image: string;
  env: V1EnvVar[];
  activeDeadlineSeconds: number;
  pod: RunPodConfig;
}): V1Job {
  const { name, labels, pod: p } = o;
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name, labels },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: o.activeDeadlineSeconds,
      ttlSecondsAfterFinished: TTL_AFTER_FINISHED_SECONDS,
      template: {
        metadata: { labels },
        spec: {
          restartPolicy: 'Never',
          automountServiceAccountToken: false,
          enableServiceLinks: false,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: RUNNER_UID,
            runAsGroup: RUNNER_UID,
            fsGroup: RUNNER_UID,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          ...(p.nodeSelector ? { nodeSelector: p.nodeSelector } : {}),
          ...(p.tolerations ? { tolerations: p.tolerations } : {}),
          ...(p.runtimeClassName ? { runtimeClassName: p.runtimeClassName } : {}),
          containers: [
            {
              name: RUN_CONTAINER,
              image: o.image,
              envFrom: [{ secretRef: { name } }],
              env: o.env,
              resources: {
                requests: { cpu: p.cpuRequest, memory: p.memoryRequest },
                limits: { cpu: p.cpuLimit, memory: p.memoryLimit, 'ephemeral-storage': p.ephemeralStorageLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                runAsNonRoot: true,
                runAsUser: RUNNER_UID,
                capabilities: { drop: ['ALL'] },
                seccompProfile: { type: 'RuntimeDefault' },
              },
              volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }],
            },
          ],
          volumes: [{ name: 'workspace', emptyDir: { sizeLimit: p.workspaceSizeLimit } }],
        },
      },
    },
  };
}

/**
 * The run Job (spec §8, Architecture §5). The image's entrypoint runs the agent; nothing here builds a command line,
 * so untrusted values (the prompt, refs) are only ever env values. The clone URL and the agent credential come from
 * Secret `run-{runId}` through `envFrom`.
 */
export function buildRunJob(input: RunJobInput): V1Job {
  const timeout = Math.min(Math.max(1, Math.floor(input.timeoutSeconds)), TIMEOUT_SECONDS_MAX);
  const env: V1EnvVar[] = [
    { name: 'CHECKOUT_REF', value: input.checkoutRef },
    { name: 'PROMPT', value: input.prompt },
    { name: 'BOT_NAME', value: input.botName },
    { name: 'BOT_EMAIL', value: input.botEmail },
    { name: 'PLUGIN_MARKETPLACES', value: JSON.stringify(input.pluginMarketplaces) },
    { name: 'SETUP_TIMEOUT_SECONDS', value: String(input.setupTimeoutSeconds) },
    ...(input.setupScript ? [{ name: 'SETUP_SCRIPT', value: input.setupScript }] : []),
    ...(input.maxTurns !== null ? [{ name: 'MAX_TURNS', value: String(input.maxTurns) }] : []),
  ];
  return podJob({
    name: runJobName(input.runId),
    labels: runLabels(input),
    image: input.image,
    env,
    activeDeadlineSeconds: timeout + DEADLINE_MARGIN_SECONDS,
    pod: input.pod,
  });
}

export interface SetupTestJobInput {
  setupTestId: string;
  orgId: string;
  projectId: string;
  image: string;
  checkoutRef: string;
  /** The script under test (untrusted text): an env value only. Empty means none. */
  script: string;
  pluginMarketplaces: Record<string, string>;
  setupTimeoutSeconds: number;
  /** How long the workspace stays up after setup, from platform config (`SETUP_TEST_TTL_SECONDS`). */
  ttlSeconds: number;
  botName: string;
  botEmail: string;
  pod: RunPodConfig;
}

export function setupTestLabels(input: {
  setupTestId: string;
  orgId: string;
  projectId: string;
}): Record<string, string> {
  return {
    'app.kubernetes.io/managed-by': 'agentdesk',
    [SETUP_TEST_LABELS.kind]: SETUP_TEST_KIND,
    [SETUP_TEST_LABELS.setupTestId]: input.setupTestId,
    [RUN_LABELS.projectId]: input.projectId,
    [RUN_LABELS.orgId]: input.orgId,
  };
}

/** Setup-test Job: the runner in `RUN_MODE=setup_test` (plugins, setup, then an idle shell). No agent credential, no prompt. */
export function buildSetupTestJob(input: SetupTestJobInput): V1Job {
  assertUuid(input.setupTestId, 'setup test');
  assertUuid(input.orgId, 'org');
  assertUuid(input.projectId, 'project');
  const env: V1EnvVar[] = [
    { name: 'RUN_MODE', value: 'setup_test' },
    { name: 'CHECKOUT_REF', value: input.checkoutRef },
    { name: 'BOT_NAME', value: input.botName },
    { name: 'BOT_EMAIL', value: input.botEmail },
    { name: 'PLUGIN_MARKETPLACES', value: JSON.stringify(input.pluginMarketplaces) },
    { name: 'SETUP_TIMEOUT_SECONDS', value: String(input.setupTimeoutSeconds) },
    ...(input.script ? [{ name: 'SETUP_SCRIPT', value: input.script }] : []),
  ];
  return podJob({
    name: setupTestJobName(input.setupTestId),
    labels: setupTestLabels(input),
    image: input.image,
    env,
    activeDeadlineSeconds: input.setupTimeoutSeconds + input.ttlSeconds + 300,
    pod: input.pod,
  });
}
