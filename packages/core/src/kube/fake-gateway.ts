import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { assertSecretName } from '../secrets/secret-store';
import {
  TMUX_ATTACH,
  TMUX_KILL,
  runRefFromLabels,
  sameCommand,
  setupTestRefFromLabels,
  type ExecSession,
  type KubeGateway,
  type RunJobRef,
  type RunPod,
  type RunSecretRef,
  type SetupTestJobRef,
  type SetupTestSecretRef,
  type V1Job,
} from './gateway';

const FAKE_POD = fileURLToPath(new URL('./fake-pod.mjs', import.meta.url));
const FAKE_POD_FILE = 'fake-pod.mjs';
const JOB_NAME = /^(run|setup-test)-[a-z0-9-]{1,60}$/;
const RUN_JOB_NAME = /^run-[a-z0-9-]{1,60}$/;
const SETUP_TEST_JOB_NAME = /^setup-test-[a-z0-9-]{1,60}$/;
const TICK_MS = 50;
const SECRETS_DIR = '.secrets';

const JobFile = z.object({ labels: z.record(z.string(), z.string()), createdAt: z.string() });
const SecretFile = z.object({ labels: z.record(z.string(), z.string()), data: z.record(z.string(), z.string()) });
const execFileAsync = promisify(execFile);

export interface FakeKubeOptions {
  /** FAKE_TURN_MS for spawned pods (the pod's default is 2000). */
  turnMs?: number;
}

function assertJobName(name: string): void {
  if (!JOB_NAME.test(name)) throw new Error('fake kube: invalid job name');
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });

async function readOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Reads bytes [offset, end) of a file; empty when the file is missing. */
async function readFrom(file: string, offset: number): Promise<Buffer> {
  let fh;
  try {
    fh = await open(file, 'r');
  } catch {
    return Buffer.alloc(0);
  }
  try {
    const { size } = await fh.stat();
    if (size <= offset) return Buffer.alloc(0);
    const buf = Buffer.alloc(size - offset);
    await fh.read(buf, 0, buf.length, offset);
    return buf;
  } finally {
    await fh.close();
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The process's command line (`ps -o command=`, macOS and Linux), or null when there is no such process. */
async function commandLine(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)]);
    return stdout.trim() || null;
  } catch {
    return null; // ps exits 1 when the pid does not exist
  }
}

async function readPid(dir: string): Promise<number | null> {
  const pid = Number.parseInt((await readOrNull(join(dir, 'pid'))) ?? '', 10);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

function killGroup(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** The pod state for a pod whose `exit` file holds `raw`. */
function exitedPod(jobName: string, raw: string): RunPod {
  const code = Number.parseInt(raw, 10);
  return {
    name: jobName,
    phase: code === 0 ? 'Succeeded' : 'Failed',
    pendingSince: null,
    reason: code === 0 ? null : 'Error',
    exitCode: Number.isNaN(code) ? 1 : code,
  };
}

/**
 * KUBE_MODE=fake: each Job is a detached child process running `fake-pod.mjs` with file-backed state under
 * `<dir>/<jobName>/`, so the whole run flow (logs, attach, kill-session, exit codes) works without a cluster.
 * Run Secrets are files under `<dir>/.secrets/` (mode 0600; local development only).
 */
export class FakeKubeGateway implements KubeGateway {
  private readonly children = new Map<string, ChildProcess>();
  private readonly envs = new Map<string, Record<string, string>>();

  constructor(
    private readonly dir: string,
    private readonly opts: FakeKubeOptions = {},
  ) {}

  private jobDir(name: string): string {
    assertJobName(name);
    return join(this.dir, name);
  }

  private secretFile(name: string): string {
    assertSecretName(name);
    return join(this.dir, SECRETS_DIR, `${name}.json`);
  }

  async ensureSecret(name: string, data: Record<string, string>, labels: Record<string, string>): Promise<void> {
    const file = this.secretFile(name);
    await mkdir(join(this.dir, SECRETS_DIR), { recursive: true, mode: 0o700 });
    try {
      await writeFile(file, JSON.stringify({ labels, data }), { flag: 'wx', mode: 0o600 });
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'EEXIST') return; // already exists → success
      throw err;
    }
  }

  async readSecret(name: string): Promise<Record<string, string> | null> {
    const raw = await readOrNull(this.secretFile(name));
    if (raw === null) return null;
    const parsed = SecretFile.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error('fake kube: corrupt secret file');
    return parsed.data.data;
  }

  async deleteSecret(name: string): Promise<void> {
    await rm(this.secretFile(name), { force: true });
  }

  async ensureJob(spec: V1Job): Promise<void> {
    const name = spec.metadata?.name ?? '';
    const dir = this.jobDir(name);
    await mkdir(this.dir, { recursive: true });
    try {
      await mkdir(dir); // atomic: a second ensureJob sees EEXIST and does nothing
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'EEXIST') return;
      throw err;
    }
    await writeFile(
      join(dir, 'job.json'),
      JSON.stringify({ labels: spec.metadata?.labels ?? {}, createdAt: new Date().toISOString() }),
    );

    const container = spec.spec?.template.spec?.containers[0];
    const env: Record<string, string> = {};
    for (const from of container?.envFrom ?? []) {
      const secretName = from.secretRef?.name;
      if (secretName) Object.assign(env, (await this.readSecret(secretName)) ?? {});
    }
    for (const e of container?.env ?? []) if (e.value !== undefined) env[e.name] = e.value;
    this.envs.set(name, env);

    // Env values reach the child as data; there is no shell anywhere on this path.
    const child = spawn(process.execPath, [FAKE_POD, dir], {
      detached: true,
      stdio: 'ignore',
      env: {
        PATH: process.env.PATH ?? '',
        ...(this.opts.turnMs !== undefined ? { FAKE_TURN_MS: String(this.opts.turnMs) } : {}),
        ...env,
      },
    });
    child.on('error', () => undefined);
    child.on('exit', () => this.children.delete(name));
    child.unref();
    if (child.pid !== undefined) {
      this.children.set(name, child);
      await writeFile(join(dir, 'pid'), String(child.pid));
    }
  }

  async getRunPod(jobName: string): Promise<RunPod | null> {
    const dir = this.jobDir(jobName);
    const jobRaw = await readOrNull(join(dir, 'job.json'));
    if (jobRaw === null) return null;
    const exit = await readOrNull(join(dir, 'exit'));
    if (exit !== null) return exitedPod(jobName, exit);
    const pid = await readPid(dir);
    if (pid !== null && (await this.ownedPid(jobName, dir)) === null) {
      // The pod may have written `exit` and died after the read above; only a pod with no exit file was killed.
      const late = await readOrNull(join(dir, 'exit'));
      if (late !== null) return exitedPod(jobName, late);
      return { name: jobName, phase: 'Failed', pendingSince: null, reason: 'Killed', exitCode: 137 };
    }
    if (existsSync(join(dir, 'started'))) {
      return { name: jobName, phase: 'Running', pendingSince: null, reason: null, exitCode: null };
    }
    const job = JobFile.parse(JSON.parse(jobRaw));
    return {
      name: jobName,
      phase: 'Pending',
      pendingSince: new Date(job.createdAt),
      reason: 'ContainerCreating: fake pod has not started',
      exitCode: null,
    };
  }

  async *streamLogs(podName: string, signal: AbortSignal): AsyncIterable<string> {
    const dir = this.jobDir(podName);
    let offset = 0;
    let partial = '';
    const decoder = new StringDecoder('utf8'); // a multi-byte character may straddle two reads
    while (!signal.aborted) {
      // Check for the exit marker before reading: everything logged before it is then read in this pass.
      const exited = existsSync(join(dir, 'exit')) || !existsSync(dir);
      const buf = await readFrom(join(dir, 'log'), offset);
      offset += buf.length;
      partial += decoder.write(buf);
      const lines = partial.split('\n');
      partial = lines.pop() ?? '';
      for (const l of lines) {
        if (signal.aborted) return;
        yield l.replace(/\r$/, '');
      }
      if (exited) {
        partial += decoder.end();
        if (partial.length > 0) yield partial;
        return;
      }
      await sleep(TICK_MS, signal);
    }
  }

  async exec(podName: string, command: string[], _opts: { tty: boolean }): Promise<ExecSession> {
    const dir = this.jobDir(podName);
    if (!existsSync(join(dir, 'job.json'))) throw new Error('fake kube: pod not found');
    if (sameCommand(command, TMUX_KILL)) {
      await writeFile(join(dir, 'kill'), '');
      return closedSession(0);
    }
    if (sameCommand(command, TMUX_ATTACH)) return attachSession(dir);
    throw new Error('fake kube: exec command not supported');
  }

  async deleteJob(jobName: string): Promise<void> {
    const dir = this.jobDir(jobName);
    const pid = await this.ownedPid(jobName, dir);
    if (pid !== null) killGroup(pid);
    this.children.delete(jobName);
    this.envs.delete(jobName);
    await rm(dir, { recursive: true, force: true });
  }

  async listRunJobs(): Promise<RunJobRef[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: RunJobRef[] = [];
    for (const name of names) {
      if (!RUN_JOB_NAME.test(name)) continue;
      const raw = await readOrNull(join(this.dir, name, 'job.json'));
      if (raw === null) continue;
      const parsed = JobFile.safeParse(JSON.parse(raw));
      if (!parsed.success) continue;
      const ref = runRefFromLabels(parsed.data.labels);
      if (ref) out.push({ jobName: name, ...ref });
    }
    return out;
  }

  async listSetupTestJobs(): Promise<SetupTestJobRef[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: SetupTestJobRef[] = [];
    for (const name of names) {
      if (!SETUP_TEST_JOB_NAME.test(name)) continue;
      const raw = await readOrNull(join(this.dir, name, 'job.json'));
      if (raw === null) continue;
      const parsed = JobFile.safeParse(JSON.parse(raw));
      if (!parsed.success) continue;
      const ref = setupTestRefFromLabels(parsed.data.labels);
      if (ref) out.push({ jobName: name, ...ref });
    }
    return out;
  }

  async listSetupTestSecrets(): Promise<SetupTestSecretRef[]> {
    let files: string[];
    try {
      files = await readdir(join(this.dir, SECRETS_DIR));
    } catch {
      return [];
    }
    const out: SetupTestSecretRef[] = [];
    for (const file of files) {
      const secretName = file.replace(/\.json$/, '');
      if (!SETUP_TEST_JOB_NAME.test(secretName)) continue;
      const raw = await readOrNull(join(this.dir, SECRETS_DIR, file));
      const parsed = raw === null ? null : SecretFile.safeParse(JSON.parse(raw));
      const ref = parsed?.success ? setupTestRefFromLabels(parsed.data.labels) : null;
      if (ref) out.push({ secretName, ...ref });
    }
    return out;
  }

  async listRunSecrets(): Promise<RunSecretRef[]> {
    let files: string[];
    try {
      files = await readdir(join(this.dir, SECRETS_DIR));
    } catch {
      return [];
    }
    const out: RunSecretRef[] = [];
    for (const file of files) {
      const secretName = file.replace(/\.json$/, '');
      if (!JOB_NAME.test(secretName)) continue;
      const raw = await readOrNull(join(this.dir, SECRETS_DIR, file));
      const parsed = raw === null ? null : SecretFile.safeParse(JSON.parse(raw));
      const ref = parsed?.success ? runRefFromLabels(parsed.data.labels) : null;
      if (ref) out.push({ secretName, ...ref });
    }
    return out;
  }

  /**
   * The pid of this job's fake pod if it is still running and really is ours. Never trusts the pid file alone: after
   * the pod exited (`exit` written) or died, the pid may belong to an unrelated process (pid reuse). Ownership is the
   * live child handle, or a command line naming fake-pod.mjs and this job's dir.
   */
  private async ownedPid(jobName: string, dir: string): Promise<number | null> {
    if (existsSync(join(dir, 'exit'))) return null;
    const pid = await readPid(dir);
    if (pid === null || !isAlive(pid)) return null;
    if (this.children.get(jobName)?.pid === pid) return pid;
    const cmd = await commandLine(pid);
    return cmd !== null && cmd.includes(FAKE_POD_FILE) && cmd.includes(dir) ? pid : null;
  }

  // ---- test helpers

  /** Processes this gateway spawned that are still running. */
  async processIds(): Promise<{ jobName: string; pid: number }[]> {
    const out: { jobName: string; pid: number }[] = [];
    for (const [jobName, c] of this.children) if (c.pid !== undefined) out.push({ jobName, pid: c.pid });
    return out;
  }

  /** The env a pod was started with (in memory only). */
  async podEnv(jobName: string): Promise<Record<string, string> | undefined> {
    return this.envs.get(jobName);
  }

  /** Kills every fake pod under the state dir (test teardown). */
  async killAll(): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir);
    } catch {
      // nothing started
    }
    for (const name of names) {
      if (!JOB_NAME.test(name)) continue;
      const pid = await this.ownedPid(name, join(this.dir, name));
      if (pid !== null) killGroup(pid);
    }
    // Live child handles are ours by construction (exited children leave the map).
    for (const c of this.children.values()) if (c.pid !== undefined && c.exitCode === null) killGroup(c.pid);
    this.children.clear();
  }
}

function closedSession(code: number): ExecSession {
  return {
    write: () => undefined,
    resize: () => undefined,
    onData: () => undefined,
    onClose: (cb) => queueMicrotask(() => cb(code)),
    close: () => undefined,
  };
}

/** `tmux attach`: the full pane, then appended bytes; writes go to `input`. Ends when the pod exits or on close(). */
function attachSession(dir: string): ExecSession {
  const dataCbs: ((d: Uint8Array) => void)[] = [];
  const closeCbs: ((code: number) => void)[] = [];
  const ac = new AbortController();
  let closed = false;
  let writes = Promise.resolve();
  const close = (code: number): void => {
    if (closed) return;
    closed = true;
    ac.abort();
    for (const cb of closeCbs.splice(0)) cb(code);
  };
  void (async () => {
    let offset = 0;
    // Let the caller register onData before the first bytes.
    await sleep(0);
    while (!ac.signal.aborted) {
      const exited = existsSync(join(dir, 'exit')) || !existsSync(dir);
      const buf = await readFrom(join(dir, 'pane'), offset);
      offset += buf.length;
      if (buf.length > 0) for (const cb of dataCbs) cb(new Uint8Array(buf));
      if (exited) return close(0);
      await sleep(TICK_MS, ac.signal);
    }
  })().catch(() => close(1));
  return {
    write: (data) => {
      if (closed) return;
      const chunk = Buffer.from(data);
      writes = writes.then(() => appendFile(join(dir, 'input'), chunk)).catch(() => undefined);
    },
    resize: () => undefined,
    onData: (cb) => void dataCbs.push(cb),
    onClose: (cb) => {
      if (closed) queueMicrotask(() => cb(0));
      else closeCbs.push(cb);
    },
    close: () => close(0),
  };
}
