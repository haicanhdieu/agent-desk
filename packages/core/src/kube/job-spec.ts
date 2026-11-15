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
  /** Keys of the agent credential in the run Secret (e.g. `CLAUDE_CODE_OAUTH_TOKEN`); each reaches the pod as an env var. */
  credentialEnvKeys: string[];
  /** Username git sends with the workspace token (from the code host adapter). */
  gitUsername: string;
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

/** Key in the run Secret that holds the repo URL (no credentials in it); reaches the pod as env `REPO_CLONE_URL`. */
export const REPO_URL_KEY = 'REPO_CLONE_URL';
/**
 * Key in the run Secret that holds the workspace token. It is mounted as a file, never an env var, so the worker can
 * rotate it in the running pod (ADR 0021). The kubelet refreshes the mounted file; a container's env never changes.
 */
export const WORKSPACE_TOKEN_KEY = 'workspace-token';
const TOKEN_VOLUME = 'workspace-token';
const TOKEN_DIR = '/var/run/agentdesk/workspace-token';
const TOKEN_FILE = 'token';
/** The mounted Secret file is readable by the pod's group (`fsGroup`) only. */
const TOKEN_FILE_MODE = 0o440;

/** `activeDeadlineSeconds` = timeout + this, a backstop to the workflow's hard timer. */
const DEADLINE_MARGIN_SECONDS = 120;
/**
 * Setup-test `activeDeadlineSeconds` = setup timeout + TTL + this: Pending and the clone (420 s), ten plugin commands at
 * the runner's 120 s limit each (1200 s), and the setup kill grace (10 s). A backstop only: the workflow deletes the Job.
 */
const SETUP_TEST_DEADLINE_MARGIN_SECONDS = 420 + 10 * 120 + 10;
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
 * setup-test Jobs cannot drift. `name` is also the Secret the pod reads: the repo URL and `secretEnvKeys` become env
 * vars through explicit `secretKeyRef`s (no `envFrom`, so the workspace token key is never an env var), and the
 * workspace token key is mounted read-only as a file.
 */
function podJob(o: {
  name: string;
  labels: Record<string, string>;
  image: string;
  env: V1EnvVar[];
  secretEnvKeys: string[];
  gitUsername: string;
  activeDeadlineSeconds: number;
  pod: RunPodConfig;
}): V1Job {
  const { name, labels, pod: p } = o;
  const secretEnv: V1EnvVar[] = [REPO_URL_KEY, ...o.secretEnvKeys].map((key) => ({
    name: key,
    valueFrom: { secretKeyRef: { name, key } },
  }));
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
              env: [
                ...secretEnv,
                { name: 'AGENTDESK_TOKEN_FILE', value: `${TOKEN_DIR}/${TOKEN_FILE}` },
                { name: 'AGENTDESK_GIT_USERNAME', value: o.gitUsername },
                ...o.env,
              ],
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
              volumeMounts: [
                { name: 'workspace', mountPath: '/workspace' },
                { name: TOKEN_VOLUME, mountPath: TOKEN_DIR, readOnly: true },
              ],
            },
          ],
          volumes: [
            { name: 'workspace', emptyDir: { sizeLimit: p.workspaceSizeLimit } },
            {
              name: TOKEN_VOLUME,
              secret: {
                secretName: name,
                items: [{ key: WORKSPACE_TOKEN_KEY, path: TOKEN_FILE }],
                defaultMode: TOKEN_FILE_MODE,
              },
            },
          ],
        },
      },
    },
  };
}

/**
 * The run Job (spec §8, Architecture §5). The image's entrypoint runs the agent; nothing here builds a command line,
 * so untrusted values (the prompt, refs) are only ever env values. The repo URL and the agent credential come from
 * Secret `run-{runId}` through `secretKeyRef`s; the workspace token is a mounted file (see `podJob`).
 */
export function buildRunJob(input: RunJobInput): V1Job {
  // No cap here: the contract bounds the limit (7 days) and the workspace token is refreshed in the pod (ADR 0021).
  const timeout = Math.max(1, Math.floor(input.timeoutSeconds));
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
    secretEnvKeys: input.credentialEnvKeys,
    gitUsername: input.gitUsername,
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
  /** Username git sends with the workspace token (from the code host adapter). */
  gitUsername: string;
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
    secretEnvKeys: [],
    gitUsername: input.gitUsername,
    activeDeadlineSeconds: input.setupTimeoutSeconds + input.ttlSeconds + SETUP_TEST_DEADLINE_MARGIN_SECONDS,
    pod: input.pod,
  });
}
