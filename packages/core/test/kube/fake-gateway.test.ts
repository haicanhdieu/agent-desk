import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeKubeGateway, commandLine } from '../../src/kube/fake-gateway';
import { buildRunJob, buildSetupTestJob, type ProjectEnvInput } from '../../src/kube/job-spec';
import type { ExecSession } from '../../src/kube/gateway';

const ORG = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
let dir: string;
let gw: FakeKubeGateway;
let n = 0;
const sessions: ExecSession[] = [];

const runId = (): string => `11111111-1111-4111-8111-${String(++n).padStart(12, '0')}`;
const job = (id: string, prompt: string, extraEnv: Record<string, string> = {}) => {
  const j = jobFor(id, prompt);
  const container = j.spec?.template.spec?.containers[0];
  for (const [name, value] of Object.entries(extraEnv)) container?.env?.push({ name, value });
  return j;
};
const jobFor = (
  id: string,
  prompt: string,
  resume = false,
  author = { name: 'bot', email: 'bot@x.invalid', authorizedBy: 'bot' },
  projectEnv?: ProjectEnvInput,
) =>
  buildRunJob({
    runId: id,
    orgId: ORG,
    projectId: PROJECT,
    image: 'fake',
    prompt,
    checkoutRef: 'main',
    credentialEnvKeys: ['TOKEN'],
    gitUsername: 'x-access-token',
    gitHost: 'fake.invalid',
    cliTokenEnvName: 'GH_TOKEN',
    maxTurns: null,
    agentEnv: [{ name: 'AGENT_MODEL', value: 'claude-opus-4-1' }],
    deadlineSeconds: 60,
    resume,
    botName: 'bot',
    botEmail: 'bot@x.invalid',
    author,
    pluginMarketplaces: {},
    setupTimeoutSeconds: 600,
    setupScript: null,
    projectEnv,
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

/** The pod's current screen, read through an attach session. */
async function gwPane(name: string): Promise<string> {
  const s = await gw.exec(name, ['tmux', 'attach', '-t', 'agent'], { tty: true });
  let screen = '';
  s.onData((d) => (screen += decoder.decode(d)));
  await sleep(120);
  s.close();
  return screen;
}

const decoder = new TextDecoder();
const b64 = (t: string): string => Buffer.from(t, 'utf8').toString('base64');
const NEEDS = `agentdesk: state needs_input declared ${b64('Fake agent is waiting')}`;

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
  it('ensureJob twice starts one process; streamLogs yields session started then the state protocol', async () => {
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
    await until(async () => c.lines.length >= 9);
    expect(c.lines.slice(0, 9)).toEqual([
      'agentdesk: agent claude model claude-opus-4-1 endpoint default',
      'agentdesk: git identity bot bot@x.invalid',
      `agentdesk: checkout ${'0'.repeat(40)}`,
      'agentdesk: plugins begin',
      'agentdesk: plugins end',
      'agentdesk: setup skipped (no script)',
      'agentdesk: session started',
      'agentdesk: state working',
      `agentdesk: state needs_input declared ${b64('Fake agent is waiting')}`,
    ]);
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);
    expect(await gw.getRunPod(name)).toBeNull();
  });

  it('logs the git identity the Job gives the run, so the trigger person can be seen reaching the pod', async () => {
    const id = runId();
    const name = `run-${id}`;
    const author = { name: 'alice', email: 'alice@users.noreply.fake.invalid', authorizedBy: 'alice' };
    await gw.ensureJob(jobFor(id, 'do it', false, author));
    const c = collect(name);
    await until(async () => c.lines.includes('agentdesk: session started'));
    expect(c.lines).toContain('agentdesk: git identity alice alice@users.noreply.fake.invalid');
    expect(c.lines.join('\n')).not.toContain('bot@x.invalid');
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);
  });

  it('a resumed Job on the same volume continues the conversation; with the volume deleted it exits 79', async () => {
    const id = runId();
    const name = `run-${id}`;
    const labels = { 'agentdesk/run-id': id };
    await gw.ensureVolumeClaim(name, { size: '1Gi' }, labels);
    await gw.ensureJob(job(id, 'remember this'));
    await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
    await until(async () => (await gw.getRunPod(name)) && (await gwPane(name)).includes('remember this'));
    await gw.deleteJob(name); // the idle stop: the pod is gone, the volume stays

    await gw.ensureJob(jobFor(id, '', true));
    const c = collect(name);
    await until(async () => c.lines.includes('agentdesk: session started'));
    expect(c.lines.slice(0, 4)).toEqual([
      'agentdesk: agent claude model claude-opus-4-1 endpoint default',
      'agentdesk: git identity bot bot@x.invalid',
      'agentdesk: session resumed',
      'agentdesk: session started',
    ]);
    expect(await gwPane(name)).toContain('remember this');
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);

    await gw.deleteVolumeClaim(name);
    await gw.ensureJob(jobFor(id, '', true));
    const pod = await until(async () => {
      const p = await gw.getRunPod(name);
      return p?.phase === 'Failed' || p?.phase === 'Succeeded' ? p : null;
    });
    expect(pod.exitCode).toBe(79);
    await gw.deleteJob(name);
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
    await until(async () => c.lines.filter((l) => l === NEEDS).length >= 2);
    // A typed line starts a turn (state working) between the two ends.
    const firstEnd = c.lines.indexOf(NEEDS);
    const working = c.lines.indexOf('agentdesk: state working', firstEnd);
    expect(working).toBeGreaterThan(firstEnd);
    expect(working).toBeLessThan(c.lines.lastIndexOf(NEEDS));

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

  it('agentdesk-end exits 0 and the pod ends with the scrollback and reason=stop_request', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'end me'));
    await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
    const c = collect(name);
    const end = await gw.exec(name, ['agentdesk-end'], { tty: false });
    expect(await new Promise<number>((r) => end.onClose(r))).toBe(0);
    await c.done; // the stream ends when the pod exits
    expect(c.lines.at(-1)).toBe('agentdesk: session ended reason=stop_request code=0');
    expect(c.lines.at(-2)).toBe('agentdesk: final scrollback end');
    expect(await gw.getRunPod(name)).toMatchObject({ phase: 'Succeeded', exitCode: 0 });
    await gw.deleteJob(name);
  });

  it('agentdesk-end takes no arguments', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'x'));
    await expect(gw.exec(name, ['agentdesk-end', 'now'], { tty: false })).rejects.toThrow(/not supported/);
    await gw.deleteJob(name);
  });

  it('agentdesk-attach streams like tmux attach; agentdesk-detach records the id and exits 0', async () => {
    const id = runId();
    const name = `run-${id}`;
    const conn = '123e4567-e89b-42d3-a456-426614174000';
    await gw.ensureJob(job(id, 'hello prompt'));
    await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
    const s = await gw.exec(name, ['agentdesk-attach', conn], { tty: true });
    sessions.push(s);
    let screen = '';
    s.onData((d) => {
      screen += decoder.decode(d);
    });
    await until(async () => screen.includes('hello prompt'));
    const detach = await gw.exec(name, ['agentdesk-detach', conn], { tty: false });
    expect(await new Promise<number>((r) => detach.onClose(r))).toBe(0);
    expect(gw.detachedIds).toEqual([conn]);
    await gw.deleteJob(name);
  });

  it('agentdesk-attach on a pod that already exited closes with 3 (no session)', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'x'));
    await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
    const kill = await gw.exec(name, ['tmux', 'kill-session', '-t', 'agent'], { tty: false });
    await new Promise<number>((r) => kill.onClose(r));
    await until(async () => (await gw.getRunPod(name))?.phase === 'Succeeded');
    const s = await gw.exec(name, ['agentdesk-attach', '123e4567-e89b-42d3-a456-426614174000'], { tty: true });
    expect(await new Promise<number>((r) => s.onClose(r))).toBe(3);
    await gw.deleteJob(name);
  });

  it('rejects an agentdesk-attach or -detach with a bad id', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'x'));
    await expect(gw.exec(name, ['agentdesk-attach', 'x; rm -rf /'], { tty: true })).rejects.toThrow(/not supported/);
    await expect(gw.exec(name, ['agentdesk-detach', 'nope'], { tty: false })).rejects.toThrow(/not supported/);
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
    expect(c.lines).toContain(NEEDS);
    expect(c.lines).toContain('agentdesk: final scrollback end');
    await gw.deleteJob(name);
  });

  it('--fake-done ends the turn with state done', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'Arguments from the user: --fake-done'));
    const c = collect(name);
    await until(async () => c.lines.includes(`agentdesk: state done declared ${b64('Fake agent finished')}`));
    expect(c.lines).not.toContain(NEEDS);
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);
  });

  it('--fake-background emits state waiting background, then wakes up and ends the turn', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureJob(job(id, 'Arguments from the user: --fake-background'));
    const c = collect(name);
    await until(async () => c.lines.includes(NEEDS));
    const waiting = c.lines.indexOf('agentdesk: state waiting background');
    expect(waiting).toBeGreaterThan(c.lines.indexOf('agentdesk: session started'));
    expect(c.lines.indexOf('agentdesk: state working', waiting)).toBeGreaterThan(waiting);
    expect(c.lines.indexOf(NEEDS)).toBeGreaterThan(waiting);
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);
  });

  describe('setup phase', () => {
    it('real mode with --fake-setup-fail exits 78 before session started', async () => {
      const id = runId();
      const name = `run-${id}`;
      await gw.ensureJob(job(id, 'go', { SETUP_SCRIPT: 'exit 1 # --fake-setup-fail' }));
      const pod = await until(async () => {
        const p = await gw.getRunPod(name);
        return p?.phase === 'Failed' ? p : null;
      });
      expect(pod.exitCode).toBe(78);
      const c = collect(name);
      await c.done;
      expect(c.lines).toContain('agentdesk: setup begin');
      expect(c.lines).toContain('agentdesk: setup failed exit=1');
      expect(c.lines).not.toContain('agentdesk: session started');
      await gw.deleteJob(name);
    });

    it('real mode with a script passes without running it', async () => {
      const id = runId();
      const name = `run-${id}`;
      const marker = join(dir, `ran-${id}`);
      await gw.ensureJob(job(id, 'go', { SETUP_SCRIPT: `touch ${marker}` }));
      await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
      const c = collect(name);
      await until(async () => c.lines.includes('agentdesk: session started'));
      expect(c.lines).toContain('agentdesk: setup passed');
      await expect(readFile(marker)).rejects.toThrow();
      c.ac.abort();
      await c.done;
      await gw.deleteJob(name);
    });

    it('setup_test mode starts a shell pane that echoes input, with no turn markers', async () => {
      const id = runId();
      const name = `run-${id}`;
      await gw.ensureJob(job(id, 'ignored', { RUN_MODE: 'setup_test', SETUP_SCRIPT: 'x --fake-setup-fail' }));
      await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
      const c = collect(name);
      await until(async () => c.lines.includes('agentdesk: session started'));
      expect(c.lines).toContain('agentdesk: setup failed exit=1');
      const s = await gw.exec(name, ['tmux', 'attach', '-t', 'agent'], { tty: true });
      sessions.push(s);
      let screen = '';
      s.onData((d) => {
        screen += decoder.decode(d);
      });
      s.write(new TextEncoder().encode('echo hi\r'));
      await until(async () => screen.includes('echo hi'));
      await sleep(400); // longer than turnMs: a turn marker would have appeared by now
      expect(c.lines.some((l) => l.startsWith('agentdesk: turn') || l.startsWith('agentdesk: state'))).toBe(false);
      const kill = await gw.exec(name, ['tmux', 'kill-session', '-t', 'agent'], { tty: false });
      await new Promise<number>((r) => kill.onClose(r));
      await c.done;
      await gw.deleteJob(name);
    });

    it('setup_test mode passes unless the script has --fake-setup-fail', async () => {
      const id = runId();
      const name = `run-${id}`;
      await gw.ensureJob(job(id, 'ignored', { RUN_MODE: 'setup_test', SETUP_SCRIPT: 'make' }));
      await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
      const c = collect(name);
      await until(async () => c.lines.includes('agentdesk: session started'));
      expect(c.lines).toContain('agentdesk: setup passed');
      c.ac.abort();
      await c.done;
      await gw.deleteJob(name);
    });
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

  it('hands the pod the original env values, unescaping $$ like the kubelet', async () => {
    const id = runId();
    const name = `run-${id}`;
    const values: Record<string, string> = {
      E2E_A: 'pa$word',
      E2E_B: '$(HOME)',
      E2E_C: '$$',
      E2E_D: 'a$',
    };
    const plain = Object.entries(values).map(([n, value]) => ({ name: n, value }));
    await gw.ensureJob(jobFor(id, 'p', false, undefined, { plain, secretNames: [] }));
    const hash = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 12);
    const c = collect(name);
    await until(async () => c.lines.some((l) => l.startsWith('agentdesk: session started')));
    const podEnv = await gw.podEnv(name);
    for (const [n, v] of Object.entries(values)) {
      expect(podEnv?.[n]).toBe(v);
      expect(c.lines).toContain(`agentdesk: env ${n} ${hash(v)}`);
    }
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);
  });

  it('a literal and a secretKeyRef E2E_ env var each make the pod log a hash line', async () => {
    const id = runId();
    const name = `run-${id}`;
    const secretName = `org-${ORG}-env-e1`;
    await gw.ensureSecret(secretName, { value: 'secret-v' }, {});
    const j = job(id, 'p', { E2E_P: 'plain-v' });
    j.spec?.template.spec?.containers[0]?.env?.push({
      name: 'E2E_S',
      valueFrom: { secretKeyRef: { name: secretName, key: 'value' } },
    });
    await gw.ensureJob(j);
    const hash = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 12);
    const c = collect(name);
    await until(async () => c.lines.some((l) => l.startsWith('agentdesk: session started')));
    expect(c.lines).toContain(`agentdesk: env E2E_P ${hash('plain-v')}`);
    expect(c.lines).toContain(`agentdesk: env E2E_S ${hash('secret-v')}`);
    expect(c.lines.join('\n')).not.toContain('secret-v');
    c.ac.abort();
    await c.done;
    await gw.deleteJob(name);
    await gw.deleteSecret(secretName);
  });

  it('replaceSecretData merges keys into an existing Secret and keeps its labels', async () => {
    const name = `run-${runId()}`;
    const labels = { 'agentdesk/run-id': 'x' };
    await gw.ensureSecret(name, { REPO_CLONE_URL: 'u', 'workspace-token': 'old' }, labels);
    await gw.replaceSecretData(name, { 'workspace-token': 'new' });
    expect(await gw.readSecret(name)).toEqual({ REPO_CLONE_URL: 'u', 'workspace-token': 'new' });
    const file = JSON.parse(await readFile(join(dir, '.secrets', `${name}.json`), 'utf8')) as { labels: unknown };
    expect(file.labels).toEqual(labels);
  });

  it('replaceSecretData fails when the Secret does not exist (a refresh must not create one)', async () => {
    await expect(gw.replaceSecretData(`run-${runId()}`, { 'workspace-token': 'x' })).rejects.toThrow();
  });

  it('the pod env gets secretKeyRef values but never the workspace token key', async () => {
    const id = runId();
    const name = `run-${id}`;
    await gw.ensureSecret(name, { REPO_CLONE_URL: 'https://x.invalid/r.git', 'workspace-token': 'tok-secret' }, {});
    await gw.ensureJob(jobFor(id, 'p'));
    const env = (gw as unknown as { envs: Map<string, Record<string, string>> }).envs.get(name);
    expect(env?.REPO_CLONE_URL).toBe('https://x.invalid/r.git');
    expect(JSON.stringify(env)).not.toContain('tok-secret');
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

  it('listSetupTestSecrets lists only setup-test labelled Secrets, with or without a Job', async () => {
    const id = runId();
    const name = `setup-test-${id}`;
    const labels = {
      'agentdesk/kind': 'setup-test',
      'agentdesk/setup-test-id': id,
      'agentdesk/org-id': ORG,
      'agentdesk/project-id': PROJECT,
    };
    await gw.ensureSecret(name, { REPO_CLONE_URL: 'x' }, labels);
    const runName = `run-${runId()}`;
    await gw.ensureSecret(
      runName,
      { A: 'b' },
      { 'agentdesk/run-id': runName, 'agentdesk/org-id': ORG, 'agentdesk/project-id': PROJECT },
    );
    expect(await gw.listSetupTestSecrets()).toContainEqual({
      secretName: name,
      setupTestId: id,
      orgId: ORG,
      projectId: PROJECT,
    });
    expect((await gw.listSetupTestSecrets()).map((x) => x.secretName)).not.toContain(runName);
    expect((await gw.listRunSecrets()).map((x) => x.secretName)).not.toContain(name);
    await gw.deleteSecret(name);
    await gw.deleteSecret(runName);
    expect((await gw.listSetupTestSecrets()).map((x) => x.secretName)).not.toContain(name);
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

  it('reports the exit code the pod wrote when it dies between the exit read and the liveness check', async () => {
    const name = `run-${runId()}`;
    const d = join(dir, name);
    await mkdir(d);
    await writeFile(join(d, 'job.json'), JSON.stringify({ labels: {}, createdAt: new Date().toISOString() }));
    await writeFile(join(d, 'pid'), String(process.pid)); // not a fake-pod process, so the liveness check says "dead"
    // The race: getRunPod has already read `exit` (absent); now the pod writes it and exits before the pid check.
    // ownedPid is private; spying on it is the only way to land the write at exactly that moment.
    const owned = vi
      .spyOn(gw as unknown as { ownedPid: () => Promise<number | null> }, 'ownedPid')
      .mockImplementation(async () => {
        await writeFile(join(d, 'exit'), '3');
        return null;
      });
    try {
      expect(await gw.getRunPod(name)).toMatchObject({ phase: 'Failed', exitCode: 3 });
    } finally {
      owned.mockRestore();
      await gw.deleteJob(name);
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

  it('runs a setup-test job to session started; listSetupTestJobs returns it and listRunJobs does not', async () => {
    const id = runId();
    const name = `setup-test-${id}`;
    const spec = buildSetupTestJob({
      setupTestId: id,
      orgId: ORG,
      projectId: PROJECT,
      image: 'fake',
      checkoutRef: 'main',
      script: 'echo hi',
      pluginMarketplaces: {},
      setupTimeoutSeconds: 600,
      botName: 'bot',
      botEmail: 'bot@x.invalid',
      gitUsername: 'x-access-token',
      gitHost: 'fake.invalid',
      cliTokenEnvName: 'GH_TOKEN',
      pod: {
        cpuRequest: '1',
        cpuLimit: '1',
        memoryRequest: '1Gi',
        memoryLimit: '1Gi',
        ephemeralStorageLimit: '1Gi',
        workspaceSizeLimit: '1Gi',
      },
    });
    await gw.ensureJob(spec);
    await until(async () => (await gw.getRunPod(name))?.phase === 'Running');
    const c = collect(name);
    await until(async () => c.lines.includes('agentdesk: session started'));
    expect(c.lines).toContain('agentdesk: setup begin');
    c.ac.abort();
    await c.done;
    expect(await gw.listSetupTestJobs()).toContainEqual({
      jobName: name,
      setupTestId: id,
      orgId: ORG,
      projectId: PROJECT,
    });
    expect((await gw.listRunJobs()).map((j) => j.jobName)).not.toContain(name);
    await gw.deleteJob(name);
    expect((await gw.listSetupTestJobs()).map((j) => j.jobName)).not.toContain(name);
  });

  it('listRunJobs keeps returning only run jobs, and job names outside run-/setup-test- are rejected', async () => {
    const id = runId();
    await gw.ensureJob(job(id, 'p'));
    const names = (await gw.listRunJobs()).map((j) => j.jobName);
    expect(names.every((n) => n.startsWith('run-'))).toBe(true);
    expect(names).toContain(`run-${id}`);
    await expect(gw.getRunPod('other-x')).rejects.toThrow(/invalid job name/);
    await gw.deleteJob(`run-${id}`);
  });

  it('volume claims: ensure twice keeps one claim, list returns labelled claims, delete is idempotent', async () => {
    const id = runId();
    const name = `run-${id}`;
    const labels = { 'agentdesk/run-id': id, 'agentdesk/org-id': ORG, 'agentdesk/project-id': PROJECT };
    await gw.ensureVolumeClaim(name, { size: '4Gi' }, labels);
    await gw.ensureVolumeClaim(name, { size: '4Gi' }, labels);
    const mine = (await gw.listRunVolumeClaims()).filter((c) => c.name === name);
    expect(mine).toEqual([{ name, runId: id, orgId: ORG, projectId: PROJECT }]);
    const bare = `run-${runId()}`;
    await gw.ensureVolumeClaim(bare, { size: '4Gi' }, { other: 'x' });
    expect((await gw.listRunVolumeClaims()).map((c) => c.name)).not.toContain(bare);
    await gw.deleteVolumeClaim(name);
    await gw.deleteVolumeClaim(name);
    await gw.deleteVolumeClaim(bare);
    expect((await gw.listRunVolumeClaims()).map((c) => c.name)).not.toContain(name);
  });

  it('lists no volume claims before any was created', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'fake-kube-empty-'));
    try {
      expect(await new FakeKubeGateway(empty).listRunVolumeClaims()).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('volume claim names are validated', async () => {
    await expect(gw.ensureVolumeClaim('../x', { size: '1Gi' }, {})).rejects.toThrow(/invalid/);
    await expect(gw.deleteVolumeClaim('../x')).rejects.toThrow(/invalid/);
  });
});

describe('FakeKubeGateway cluster outage switch', () => {
  it('with .outage present getRunPod, readSecret, ensureSecret, ensureJob, exec, deleteJob and streamLogs throw fetch failed; removing it restores them', async () => {
    const id = runId();
    await gw.ensureJob(job(id, 'x'));
    const name = `run-${id}`;
    const outage = join(dir, '.outage');
    const refused = { message: 'fetch failed', cause: { code: 'ECONNREFUSED' } };
    await writeFile(outage, '');
    try {
      const calls: Array<() => Promise<unknown>> = [
        () => gw.getRunPod(name),
        () => gw.readSecret('anything'),
        () => gw.deleteJob(name),
        () => gw.exec(name, ['tmux', 'kill-session'], { tty: false }),
        () => gw.ensureJob(job(runId(), 'y')),
        () => gw.ensureSecret('some-secret', { A: 'b' }, {}),
        async () => {
          for await (const l of gw.streamLogs(name, new AbortController().signal)) void l;
        },
      ];
      for (const call of calls) await expect(call()).rejects.toMatchObject(refused);
    } finally {
      await rm(outage, { force: true });
    }
    expect((await gw.getRunPod(name))?.name).toBe(name);
    await gw.deleteJob(name);
    expect(await gw.getRunPod(name)).toBeNull();
  });

  it('a log stream that is already running fails on its next tick when the outage starts', async () => {
    const id = runId();
    await gw.ensureJob(job(id, 'x'));
    const name = `run-${id}`;
    const outage = join(dir, '.outage');
    const stream = gw.streamLogs(name, new AbortController().signal)[Symbol.asyncIterator]();
    const first = stream.next();
    await writeFile(outage, '');
    try {
      await expect(first).rejects.toMatchObject({ message: 'fetch failed' });
    } finally {
      await rm(outage, { force: true });
      await gw.deleteJob(name);
    }
  });
});

describe('commandLine', () => {
  // The runner image has no procps (`ps`), so on Linux the fake pod's owner check reads /proc instead.
  it('reads the command line from /proc when the proc dir exists', async () => {
    const proc = await mkdtemp(join(tmpdir(), 'proc-'));
    await mkdir(join(proc, '123'));
    await writeFile(join(proc, '123', 'cmdline'), 'node\0/x/fake-pod.mjs\0/state/job-1\0');
    try {
      expect(await commandLine(123, proc)).toBe('node /x/fake-pod.mjs /state/job-1');
      expect(await commandLine(456, proc)).toBeNull();
    } finally {
      await rm(proc, { recursive: true, force: true });
    }
  });

  // Skipped where ps itself is missing (the runner image); macOS and CI have it.
  const hasPs = spawnSync('ps', ['-p', String(process.pid)]).status === 0;
  it.skipIf(!hasPs)('falls back to ps where there is no proc dir (macOS)', async () => {
    expect(await commandLine(process.pid, join(tmpdir(), 'no-such-proc-dir'))).toContain('node');
  });
});
