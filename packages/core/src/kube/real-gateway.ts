import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import type { Writable } from 'node:stream';
import { z } from 'zod';
import { BatchV1Api, CoreV1Api, KubeConfig, type V1ContainerStatus, type V1Pod } from '@kubernetes/client-node';
// Not re-exported from the package index; the package has no exports map, so the deep path is stable for v2.
import { WebSocketHandler } from '@kubernetes/client-node/dist/web-socket-handler.js';
import {
  RUN_CONTAINER,
  RUN_LABELS,
  SETUP_TEST_KIND,
  SETUP_TEST_LABELS,
  kubeStatusOf,
  runRefFromLabels,
  setupTestRefFromLabels,
  type ExecSession,
  type KubeGateway,
  type RunJobRef,
  type RunPod,
  type RunPodPhase,
  type RunSecretRef,
  type SetupTestJobRef,
  type SetupTestSecretRef,
  type V1Job,
} from './gateway';
import { FollowLog } from './follow-log';

/** Slices of the generated clients this gateway uses (object-parameter style of @kubernetes/client-node v2). */
export type KubeBatchApi = Pick<BatchV1Api, 'createNamespacedJob' | 'deleteNamespacedJob' | 'listNamespacedJob'>;
export type KubeCoreApi = Pick<
  CoreV1Api,
  | 'createNamespacedSecret'
  | 'readNamespacedSecret'
  | 'deleteNamespacedSecret'
  | 'listNamespacedPod'
  | 'listNamespacedSecret'
>;
/** The one call the gateway makes: follow a container's log into `stream` (the options-only form of `Log.log`). */
export type KubeLogApi = Pick<FollowLog, 'log'>;

/** The part of a WebSocket the exec session needs (the `ws` socket satisfies it). */
export interface ExecSocket {
  send(data: Buffer): void;
  close(): void;
  on(event: 'close', cb: () => void): void;
}

/** Opens an exec WebSocket (subprotocol `v5.channel.k8s.io`) and hands every binary frame to `onFrame`. */
export interface ExecConnector {
  connect(path: string, onFrame: (stream: number, data: Buffer) => boolean): Promise<ExecSocket>;
}

export interface RealKubeDeps {
  batch: KubeBatchApi;
  core: KubeCoreApi;
  log: KubeLogApi;
  ws: ExecConnector;
  namespace: string;
}

const STDIN = 0;
const STATUS = 3;
const RESIZE = 4;
const JOB_NAME_LABEL = 'batch.kubernetes.io/job-name';

const ExecStatus = z.object({
  status: z.string().optional(),
  details: z
    .object({ causes: z.array(z.object({ reason: z.string().optional(), message: z.string().optional() })).optional() })
    .optional(),
});

const ignore =
  (...codes: number[]) =>
  (err: unknown): void => {
    const code = kubeStatusOf(err);
    if (code === undefined || !codes.includes(code)) throw err;
  };

function toPhase(p: string | undefined): RunPodPhase {
  return p === 'Pending' || p === 'Running' || p === 'Succeeded' || p === 'Failed' ? p : 'Unknown';
}

function waitingReason(pod: V1Pod, cs: V1ContainerStatus | undefined): string | null {
  const w = cs?.state?.waiting;
  if (w?.reason) return w.message ? `${w.reason}: ${w.message}` : w.reason;
  const cond = pod.status?.conditions?.find((c) => c.type === 'PodScheduled' && c.status === 'False');
  if (cond) return cond.message ?? cond.reason ?? 'Unschedulable';
  return pod.status?.reason ?? null;
}

/** Real Kubernetes (KUBE_MODE=kubeconfig|incluster), namespace `RUNS_NAMESPACE`. */
export class RealKubeGateway implements KubeGateway {
  constructor(private readonly deps: RealKubeDeps) {}

  private get ns(): string {
    return this.deps.namespace;
  }

  async ensureSecret(name: string, data: Record<string, string>, labels: Record<string, string>): Promise<void> {
    await this.deps.core
      .createNamespacedSecret({
        namespace: this.ns,
        body: { metadata: { name, namespace: this.ns, labels }, type: 'Opaque', stringData: data },
      })
      .then(() => undefined, ignore(409));
  }

  async readSecret(name: string): Promise<Record<string, string> | null> {
    try {
      const s = await this.deps.core.readNamespacedSecret({ name, namespace: this.ns });
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.data ?? {})) out[k] = Buffer.from(v, 'base64').toString('utf8');
      return out;
    } catch (err) {
      if (kubeStatusOf(err) === 404) return null;
      throw err;
    }
  }

  async deleteSecret(name: string): Promise<void> {
    await this.deps.core.deleteNamespacedSecret({ name, namespace: this.ns }).then(() => undefined, ignore(404));
  }

  async ensureJob(spec: V1Job): Promise<void> {
    await this.deps.batch.createNamespacedJob({ namespace: this.ns, body: spec }).then(() => undefined, ignore(409));
  }

  async getRunPod(jobName: string): Promise<RunPod | null> {
    const list = await this.deps.core.listNamespacedPod({
      namespace: this.ns,
      labelSelector: `${JOB_NAME_LABEL}=${jobName}`,
    });
    // backoffLimit 0: at most one pod; take the newest if the API ever shows more.
    const pod = [...list.items].sort(
      (a, b) => (b.metadata?.creationTimestamp?.getTime() ?? 0) - (a.metadata?.creationTimestamp?.getTime() ?? 0),
    )[0];
    if (!pod?.metadata?.name) return null;
    const phase = toPhase(pod.status?.phase);
    const cs = pod.status?.containerStatuses?.find((c) => c.name === RUN_CONTAINER);
    const terminated = cs?.state?.terminated;
    return {
      name: pod.metadata.name,
      phase,
      pendingSince: phase === 'Pending' ? (pod.metadata.creationTimestamp ?? null) : null,
      reason: phase === 'Pending' ? waitingReason(pod, cs) : (terminated?.reason ?? pod.status?.reason ?? null),
      exitCode: terminated ? terminated.exitCode : null,
    };
  }

  async *streamLogs(podName: string, signal: AbortSignal): AsyncIterable<string> {
    const sink = new PassThrough();
    const controller = await this.deps.log.log(this.ns, podName, RUN_CONTAINER, sink as Writable, { follow: true });
    const stop = (): void => {
      controller.abort();
      sink.end();
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    sink.on('error', () => sink.end());
    const lines = createInterface({ input: sink, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (signal.aborted) return;
        yield line;
      }
    } finally {
      signal.removeEventListener('abort', stop);
      lines.close();
      controller.abort();
    }
  }

  async exec(podName: string, command: string[], opts: { tty: boolean }): Promise<ExecSession> {
    const q = new URLSearchParams();
    for (const c of command) q.append('command', c);
    q.set('container', RUN_CONTAINER);
    q.set('stdin', 'true');
    q.set('stdout', 'true');
    q.set('stderr', 'true');
    q.set('tty', String(opts.tty));
    const path = `/api/v1/namespaces/${encodeURIComponent(this.ns)}/pods/${encodeURIComponent(podName)}/exec?${q}`;

    const dataCbs: ((d: Uint8Array) => void)[] = [];
    const closeCbs: ((code: number) => void)[] = [];
    let exitCode = 1;
    let closed = false;
    const socket = await this.deps.ws.connect(path, (stream, data) => {
      if (stream === STATUS) {
        exitCode = parseExitCode(data);
        return true;
      }
      if (stream === 1 || stream === 2) for (const cb of dataCbs) cb(new Uint8Array(data));
      return true;
    });
    socket.on('close', () => {
      if (closed) return;
      closed = true;
      for (const cb of closeCbs.splice(0)) cb(exitCode);
    });
    const frame = (channel: number, payload: Uint8Array): Buffer => Buffer.concat([Buffer.from([channel]), payload]);
    return {
      write: (data) => {
        if (!closed) socket.send(frame(STDIN, data));
      },
      resize: (cols, rows) => {
        if (!closed) socket.send(frame(RESIZE, Buffer.from(JSON.stringify({ Width: cols, Height: rows }))));
      },
      onData: (cb) => void dataCbs.push(cb),
      onClose: (cb) => {
        if (closed) queueMicrotask(() => cb(exitCode));
        else closeCbs.push(cb);
      },
      close: () => socket.close(),
    };
  }

  async deleteJob(jobName: string): Promise<void> {
    await this.deps.batch
      .deleteNamespacedJob({ name: jobName, namespace: this.ns, propagationPolicy: 'Foreground' })
      .then(() => undefined, ignore(404));
  }

  async listRunJobs(): Promise<RunJobRef[]> {
    const list = await this.deps.batch.listNamespacedJob({ namespace: this.ns, labelSelector: RUN_LABELS.runId });
    const out: RunJobRef[] = [];
    for (const job of list.items) {
      const ref = runRefFromLabels(job.metadata?.labels);
      const jobName = job.metadata?.name;
      if (jobName && ref) out.push({ jobName, ...ref });
    }
    return out;
  }

  async listSetupTestJobs(): Promise<SetupTestJobRef[]> {
    const list = await this.deps.batch.listNamespacedJob({
      namespace: this.ns,
      labelSelector: `${SETUP_TEST_LABELS.kind}=${SETUP_TEST_KIND}`,
    });
    const out: SetupTestJobRef[] = [];
    for (const job of list.items) {
      const ref = setupTestRefFromLabels(job.metadata?.labels);
      const jobName = job.metadata?.name;
      if (jobName && ref) out.push({ jobName, ...ref });
    }
    return out;
  }

  async listSetupTestSecrets(): Promise<SetupTestSecretRef[]> {
    const list = await this.deps.core.listNamespacedSecret({
      namespace: this.ns,
      labelSelector: `${SETUP_TEST_LABELS.kind}=${SETUP_TEST_KIND}`,
    });
    const out: SetupTestSecretRef[] = [];
    for (const secret of list.items) {
      const ref = setupTestRefFromLabels(secret.metadata?.labels);
      const secretName = secret.metadata?.name;
      if (secretName && ref) out.push({ secretName, ...ref });
    }
    return out;
  }

  async listRunSecrets(): Promise<RunSecretRef[]> {
    const list = await this.deps.core.listNamespacedSecret({ namespace: this.ns, labelSelector: RUN_LABELS.runId });
    const out: RunSecretRef[] = [];
    for (const secret of list.items) {
      const ref = runRefFromLabels(secret.metadata?.labels);
      const secretName = secret.metadata?.name;
      if (secretName && ref) out.push({ secretName, ...ref });
    }
    return out;
  }
}

/** Exit code from the exec status channel (a v1 Status): Success → 0, `ExitCode` cause → its value, else 1. */
function parseExitCode(data: Buffer): number {
  let json: unknown;
  try {
    json = JSON.parse(data.toString('utf8'));
  } catch {
    return 1;
  }
  const parsed = ExecStatus.safeParse(json);
  if (!parsed.success) return 1;
  if (parsed.data.status === 'Success') return 0;
  const cause = parsed.data.details?.causes?.find((c) => c.reason === 'ExitCode');
  const n = Number.parseInt(cause?.message ?? '', 10);
  return Number.isInteger(n) ? n : 1;
}

/** Builds the real gateway from a kubeconfig file / the default chain (`kubeconfig`) or the pod's service account. */
export function createRealKubeGateway(
  mode: 'kubeconfig' | 'incluster',
  namespace: string,
  kubeconfig?: string,
): RealKubeGateway {
  const kc = new KubeConfig();
  if (mode === 'incluster') kc.loadFromCluster();
  else if (kubeconfig) kc.loadFromFile(kubeconfig);
  else kc.loadFromDefault();
  // Own streams: the handler's defaults are process stdio, which a server-sent close frame would end.
  const handler = new WebSocketHandler(kc, undefined, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  return new RealKubeGateway({
    batch: kc.makeApiClient(BatchV1Api),
    core: kc.makeApiClient(CoreV1Api),
    log: new FollowLog(kc),
    ws: {
      connect: async (path, onFrame) => {
        const ws = await handler.connect(path, null, onFrame);
        return {
          send: (d) => ws.send(d),
          close: () => ws.close(),
          on: (_event, cb) => ws.on('close', cb),
        };
      },
    },
    namespace,
  });
}
