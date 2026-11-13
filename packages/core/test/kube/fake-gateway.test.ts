import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeKubeGateway } from '../../src/kube/fake-gateway';
import { buildRunJob } from '../../src/kube/job-spec';
import type { ExecSession } from '../../src/kube/gateway';

const ORG = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
let dir: string;
let gw: FakeKubeGateway;
let n = 0;
const sessions: ExecSession[] = [];

const runId = (): string => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`;
const job = (id: string, prompt: string) =>
  buildRunJob({
    runId: id,
    orgId: ORG,
    projectId: PROJECT,
    image: 'fake',
    prompt,
    checkoutRef: 'main',
    cloneUrlSecretKey: 'REPO_CLONE_URL',
    maxTurns: null,
    timeoutSeconds: 60,
    botName: 'bot',
    botEmail: 'bot@x.invalid',
    pluginMarketplaces: {},
    setupTimeoutSeconds: 600,
    pod: {
      cpuRequest: '1',
      cpuLimit: '1',
      memoryRequest: '1Gi',
      memoryLimit: '1Gi',
      ephemeralStorageLimit: '1Gi',
      workspaceSizeLimit: '1Gi',
    },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(25);
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

/** Collects streamed lines in the background. */
function collect(name: string) {
  const ac = new AbortController();
  const lines: string[] = [];
  const done = (async () => {
    for await (const l of gw.streamLogs(name, ac.signal)) lines.push(l);
  })();
  return { lines, ac, done };
}

const decoder = new TextDecoder();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fake-kube-'));
  gw = new FakeKubeGateway(dir, { turnMs: 150 });
});

afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
});

afterAll(async () => {
  await gw.killAll();
  await rm(dir, { recursive: true, force: true });
});

describe('FakeKubeGateway', () => {
  it('ensureJob twice starts one process; streamLogs yields session started then turn finished', async () => {
    const id = runId();
    const name = `run-${id}`;
    await Promise.all([gw.ensureJob(job(id, 'do it')), gw.ensureJob(job(id, 'do it'))]);
    await gw.ensureJob(job(id, 'do it'));
    const pids = await gw.processIds();
    expect(pids.filter((p) => p.jobName === name)).toHaveLength(1);

    const pod = await until(async () => {
      const p = await gw.getRunPod(name);
      return p?.phase === 'Running' ? p : null;
    });
    expect(pod.name).toBe(name);
    const c = collect(pod.name);
    await until(async () => c.lines.length >= 5);
    expect(c.lines.slice(0, 5)).toEqual([
      `agentdesk: checkout ${'0'.repeat(40)}`,
      'agentdesk: plugins begin',
      'agentdesk: plugins end',
      'agentdesk: session started',
      'agentdesk: turn finished',
    ]);
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);
    expect(await gw.getRunPod(name)).toBeNull();
  });

  it('exec attach streams the pane, echoes input lines; kill-session exits 0 with the scrollback', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'hello prompt'));
    await until(async () => (await gw.getRunPod(name))?.phase === 'Running');

    const s = await gw.exec(name, ['tmux', 'attach', '-t', 'agent'], { tty: true });
    sessions.push(s);
    let screen = '';
    s.onData((d) => {
      screen += decoder.decode(d);
    });
    await until(async () => screen.includes('hello prompt'));
    expect(screen).toContain('Fake Claude Code');
    s.write(new TextEncoder().encode('hello\r'));
    await until(async () => /\r?\nhello\r?\n/.test(screen) || screen.endsWith('hello\r\n'));
    s.resize(120, 40);

    const c = collect(name);
    // Session started, first turn, and the turn after `hello`.
    await until(async () => c.lines.filter((l) => l === 'agentdesk: turn finished').length >= 2);
    // A typed line starts a turn (the runner's UserPromptSubmit hook), before that turn finishes.
    const started = c.lines.indexOf('agentdesk: turn started');
    expect(started).toBeGreaterThan(c.lines.indexOf('agentdesk: turn finished'));
    expect(started).toBeLessThan(c.lines.lastIndexOf('agentdesk: turn finished'));

    const kill = await gw.exec(name, ['tmux', 'kill-session', '-t', 'agent'], { tty: false });
    const code = await new Promise<number>((r) => kill.onClose(r));
    expect(code).toBe(0);
    await c.done; // the stream ends when the pod exits
    const begin = c.lines.indexOf('agentdesk: final scrollback begin');
    const end = c.lines.indexOf('agentdesk: final scrollback end');
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const scrollback = c.lines.slice(begin + 1, end).join('\n');
    expect(scrollback).toContain('hello prompt');
    expect(scrollback).toContain('hello');
    const pod = await gw.getRunPod(name);
    expect(pod).toMatchObject({ phase: 'Succeeded', exitCode: 0 });
    await gw.deleteJob(name);
  });

  it('rejects any other exec command', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'x'));
    await expect(gw.exec(name, ['sh', '-c', 'id'], { tty: false })).rejects.toThrow(/not supported/);
    await gw.deleteJob(name);
  });

  it('--fake-fail exits 3 after the first turn, after printing the scrollback', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'Arguments from the user: --fake-fail'));
    const pod = await until(async () => {
      const p = await gw.getRunPod(name);
      return p?.phase === 'Failed' ? p : null;
    });
    expect(pod.exitCode).toBe(3);
    const c = collect(name);
    await c.done;
    expect(c.lines).toContain('agentdesk: turn finished');
    expect(c.lines).toContain('agentdesk: final scrollback end');
    await gw.deleteJob(name);
  });

  it('--fake-pending stays Pending with a pendingSince; deleteJob kills the process', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'please --fake-pending'));
    await sleep(400);
    const pod = await gw.getRunPod(name);
    expect(pod?.phase).toBe('Pending');
    expect(pod?.pendingSince).toBeInstanceOf(Date);
    expect(pod?.reason).toBeTruthy();
    const pid = (await gw.processIds()).find((p) => p.jobName === name)?.pid;
    expect(pid && isAlive(pid)).toBe(true);
    await gw.deleteJob(name);
    await gw.deleteJob(name); // idempotent
    await until(async () => (pid ? !isAlive(pid) : true));
    expect(await gw.getRunPod(name)).toBeNull();
  });

  it('passes the prompt to the pod as data (never through a shell)', async () => {
    const id = runId();
    const name = `run-${id}`;
    const marker = join(dir, 'pwned');
    await gw.ensureJob(job(id, `$(touch ${marker}); \`touch ${marker}\`; touch ${marker}`));
    await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
    await sleep(200);
    await expect(readFile(marker)).rejects.toThrow();
    await gw.deleteJob(name);
  });

  it('secrets: ensure/read/delete are idempotent; the Secret reaches the pod env; listRunJobs reads labels', async () => {
    const id = runId();
    const name = `run-${id}`;
    const labels = { 'agentdesk/run-id': id, 'agentdesk/org-id': ORG, 'agentdesk/project-id': PROJECT };
    await gw.ensureSecret(name, { REPO_CLONE_URL: 'https://t@x.invalid/r.git', TOKEN: 's3cr3t' }, labels);
    await gw.ensureSecret(name, { REPO_CLONE_URL: 'other' }, {}); // already exists → success, unchanged
    expect(await gw.readSecret(name)).toEqual({ REPO_CLONE_URL: 'https://t@x.invalid/r.git', TOKEN: 's3cr3t' });
    await gw.ensureJob(job(id, 'x'));
    expect(await gw.listRunJobs()).toContainEqual({ jobName: name, runId: id, orgId: ORG, projectId: PROJECT });
    expect(await gw.podEnv(name)).toMatchObject({ TOKEN: 's3cr3t', PROMPT: 'x' });
    expect(await gw.listRunSecrets()).toContainEqual({ secretName: name, runId: id, orgId: ORG, projectId: PROJECT });
    await gw.deleteSecret(name);
    await gw.deleteSecret(name);
    expect(await gw.readSecret(name)).toBeNull();
    expect((await gw.listRunSecrets()).map((x) => x.secretName)).not.toContain(name);
    await gw.deleteJob(name);
    expect((await gw.listRunJobs()).map((j) => j.jobName)).not.toContain(name);
  });

  it('never signals a pid it does not own: exit written, or a pid file pointing at another process', async () => {
    const kill = vi.spyOn(process, 'kill');
    try {
      for (const withExit of [true, false]) {
        const name = `run-${runId()}`;
        const d = join(dir, name);
        await mkdir(d);
        await writeFile(join(d, 'job.json'), JSON.stringify({ labels: {}, createdAt: new Date().toISOString() }));
        await writeFile(join(d, 'pid'), String(process.pid)); // a reused pid: this very test process
        if (withExit) await writeFile(join(d, 'exit'), '0');
        else await writeFile(join(d, 'started'), '');
        const pod = await gw.getRunPod(name);
        expect(pod?.phase).toBe(withExit ? 'Succeeded' : 'Failed'); // not ours → treated as dead, not Running
        await gw.deleteJob(name);
        await gw.killAll();
        expect(
          kill.mock.calls.filter(([pid, sig]) => sig === 'SIGKILL' && Math.abs(Number(pid)) === process.pid),
        ).toEqual([]);
        expect(await gw.getRunPod(name)).toBeNull();
      }
    } finally {
      kill.mockRestore();
    }
  });

  it('streams a multi-byte character split across reads intact', async () => {
    const name = `run-${runId()}`;
    const d = join(dir, name);
    await mkdir(d);
    await writeFile(join(d, 'job.json'), JSON.stringify({ labels: {}, createdAt: new Date().toISOString() }));
    const bytes = Buffer.from('héllo ✓\n', 'utf8');
    const c = collect(name);
    await appendFile(join(d, 'log'), bytes.subarray(0, 2)); // ends inside 'é'
    await sleep(150);
    await appendFile(join(d, 'log'), bytes.subarray(2));
    await writeFile(join(d, 'exit'), '0');
    await c.done;
    expect(c.lines).toEqual(['héllo ✓']);
    await gw.deleteJob(name);
  });
});
