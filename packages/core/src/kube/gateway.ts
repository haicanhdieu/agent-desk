import type { V1Job } from '@kubernetes/client-node';

export type { V1Job };

/** Labels every run Job, its pod and its Secret carry (spec §8). */
export const RUN_LABELS = {
  runId: 'agentdesk/run-id',
  projectId: 'agentdesk/project-id',
  orgId: 'agentdesk/org-id',
} as const;

/** Labels a setup-test Job, its pod and its Secret carry (no run id). */
export const SETUP_TEST_LABELS = {
  kind: 'agentdesk/kind',
  setupTestId: 'agentdesk/setup-test-id',
} as const;

/** Value of `agentdesk/kind` on setup-test objects. */
export const SETUP_TEST_KIND = 'setup-test';

/** The container that runs the agent in a run pod. */
export const RUN_CONTAINER = 'agent';

export const runJobName = (runId: string): string => `run-${runId}`;

/** Name of a run's volume claim (same as its Job and Secret). */
export const runVolumeName = (runId: string): string => `run-${runId}`;

export const setupTestJobName = (setupTestId: string): string => `setup-test-${setupTestId}`;

export type RunPodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';

export interface RunPod {
  name: string;
  phase: RunPodPhase;
  /** When the pod (as far as the gateway knows) entered Pending; null when it is not Pending. */
  pendingSince: Date | null;
  /** Why it is Pending (pod event / waiting reason), or why it failed; null when unknown. */
  reason: string | null;
  /** Container exit code once it terminated. */
  exitCode: number | null;
}

/** A pods/exec session (tty). Bytes in both directions are opaque. */
export interface ExecSession {
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  onData(cb: (d: Uint8Array) => void): void;
  /** Called once with the command's exit code (0 on success, 127 when the executable was not found, 1 when unknown). */
  onClose(cb: (code: number) => void): void;
  close(): void;
}

export interface RunJobRef {
  jobName: string;
  runId: string;
  orgId: string;
  projectId: string;
}

export interface SetupTestJobRef {
  jobName: string;
  setupTestId: string;
  orgId: string;
  projectId: string;
}

export interface SetupTestSecretRef {
  secretName: string;
  setupTestId: string;
  orgId: string;
  projectId: string;
}

export interface RunSecretRef {
  secretName: string;
  runId: string;
  orgId: string;
  projectId: string;
}

export interface RunVolumeRef {
  name: string;
  runId: string;
  orgId: string;
  projectId: string;
}

/**
 * The control plane's only access to Kubernetes for runs (namespace `RUNS_NAMESPACE`). Create and delete calls are
 * idempotent: "already exists" and "not found" are success.
 */
export interface KubeGateway {
  ensureSecret(name: string, data: Record<string, string>, labels: Record<string, string>): Promise<void>;
  /**
   * Sets keys in an existing Secret and keeps the rest and its labels. Fails when the Secret is missing (a refresh must
   * never create one) or changed meanwhile (conflict: the caller retries).
   */
  replaceSecretData(name: string, data: Record<string, string>): Promise<void>;
  /** Values of a run Secret (used to build the redaction list), or null when it does not exist. */
  readSecret(name: string): Promise<Record<string, string> | null>;
  deleteSecret(name: string): Promise<void>;
  /** Creates a per-run volume claim; one that already exists is success. */
  ensureVolumeClaim(
    name: string,
    spec: { size: string; storageClass?: string },
    labels: Record<string, string>,
  ): Promise<void>;
  /** Deletes a volume claim (and with the storage class's Delete policy, its data); a missing claim is success. */
  deleteVolumeClaim(name: string): Promise<void>;
  /** Volume claims carrying the run labels. */
  listRunVolumeClaims(): Promise<RunVolumeRef[]>;
  ensureJob(spec: V1Job): Promise<void>;
  getRunPod(jobName: string): Promise<RunPod | null>;
  /** Container log lines from the start, following until the container ends or `signal` aborts. */
  streamLogs(podName: string, signal: AbortSignal): AsyncIterable<string>;
  exec(podName: string, command: string[], opts: { tty: boolean }): Promise<ExecSession>;
  /** Deletes the Job (and its pod, foreground). */
  deleteJob(jobName: string): Promise<void>;
  listRunJobs(): Promise<RunJobRef[]>;
  /** Setup-test Jobs (label `agentdesk/kind=setup-test`); a Secret of the same name holds the clone URL and runEnv. */
  listSetupTestJobs(): Promise<SetupTestJobRef[]>;
  /** Run Secrets (label `agentdesk/run-id`), including ones whose Job never existed or is gone. */
  listRunSecrets(): Promise<RunSecretRef[]>;
  /** Setup-test Secrets (label `agentdesk/kind=setup-test`), including ones whose Job never existed or is gone. */
  listSetupTestSecrets(): Promise<SetupTestSecretRef[]>;
}

/** The run labels of an object, or null when any is missing. */
export function runRefFromLabels(
  labels: Record<string, string> | undefined,
): { runId: string; orgId: string; projectId: string } | null {
  const runId = labels?.[RUN_LABELS.runId];
  const orgId = labels?.[RUN_LABELS.orgId];
  const projectId = labels?.[RUN_LABELS.projectId];
  return runId && orgId && projectId ? { runId, orgId, projectId } : null;
}

/** The setup-test labels of an object, or null when any is missing or it is not a setup test. */
export function setupTestRefFromLabels(
  labels: Record<string, string> | undefined,
): { setupTestId: string; orgId: string; projectId: string } | null {
  const setupTestId = labels?.[SETUP_TEST_LABELS.setupTestId];
  const orgId = labels?.[RUN_LABELS.orgId];
  const projectId = labels?.[RUN_LABELS.projectId];
  if (labels?.[SETUP_TEST_LABELS.kind] !== SETUP_TEST_KIND) return null;
  return setupTestId && orgId && projectId ? { setupTestId, orgId, projectId } : null;
}

/** The exec commands the control plane uses (and the only ones the fake accepts). */
export const TMUX_ATTACH = ['tmux', 'attach', '-t', 'agent'] as const;
/** Asks the runner to end the session (creates its stop file); fixed argv, no arguments. */
export const END_COMMAND = ['agentdesk-end'] as const;
/** The old end request: only the fallback when `END_COMMAND` exits 127 (an old pod image). Remove 7 days after the new image is live. */
export const TMUX_KILL = ['tmux', 'kill-session', '-t', 'agent'] as const;

/** A terminal connection id: server-made UUID, the same strict regex the runner scripts check. */
export const CONNECTION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Exit code an exec session reports when the runtime could not find the executable (old runner image). */
export const EXEC_NOT_FOUND = 127;

function checkedConnectionId(id: string): string {
  if (!CONNECTION_ID_RE.test(id)) throw new Error('invalid connection id');
  return id;
}

/** One named tmux attach client per terminal socket (argv, never a shell string). */
export const attachCommand = (id: string): string[] => ['agentdesk-attach', checkedConnectionId(id)];
/** Ends the client started by `attachCommand(id)`; idempotent in the runner. */
export const detachCommand = (id: string): string[] => ['agentdesk-detach', checkedConnectionId(id)];

export const sameCommand = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** HTTP status of a Kubernetes client error (ApiException.code), if any. */
export function kubeStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  if ('code' in err && typeof err.code === 'number') return err.code;
  if ('statusCode' in err && typeof err.statusCode === 'number') return err.statusCode;
  return undefined;
}
