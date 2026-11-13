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
  /** Called once with the command's exit code (0 on success, 1 when unknown). */
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

export interface RunSecretRef {
  secretName: string;
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
  /** Values of a run Secret (used to build the redaction list), or null when it does not exist. */
  readSecret(name: string): Promise<Record<string, string> | null>;
  deleteSecret(name: string): Promise<void>;
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
export const TMUX_KILL = ['tmux', 'kill-session', '-t', 'agent'] as const;

export const sameCommand = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** HTTP status of a Kubernetes client error (ApiException.code), if any. */
export function kubeStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  if ('code' in err && typeof err.code === 'number') return err.code;
  if ('statusCode' in err && typeof err.statusCode === 'number') return err.statusCode;
  return undefined;
}
