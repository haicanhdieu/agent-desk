import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bin = join(import.meta.dirname, '..', 'bin');
const stubs = join(import.meta.dirname, 'stubs');
const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '1f8fad5b-d9cb-469f-a165-70867728950e';

function setup(mode = 'alive') {
  const dir = mkdtempSync(join(tmpdir(), 'attach-'));
  const log = join(dir, 'stub.log');
  writeFileSync(log, '');
  const runDir = join(dir, 'run');
  const procDir = join(dir, 'proc');
  mkdirSync(procDir);
  const env = {
    PATH: [stubs, dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    STUB_LOG: log,
    STUB_TMUX_MODE: mode,
    AGENTDESK_RUN_DIR: runDir,
    AGENTDESK_PROC_DIR: procDir,
  };
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => (JSON.parse(l) as { argv: string[] }).argv);
  return { dir, runDir, procDir, env, calls };
}

const run = (script: string, arg: string, env: Record<string, string>) =>
  spawnSync('bash', [join(bin, script), arg], { env, encoding: 'utf8' });

describe('agentdesk-attach', () => {
  it('exits 3 and never attaches when the agent session is missing', () => {
    const t = setup('incident');
    expect(run('agentdesk-attach', ID, t.env).status).toBe(3);
    expect(t.calls().some((a) => a.includes('attach'))).toBe(false);
    expect(existsSync(join(t.runDir, 'attach', `${ID}.pid`))).toBe(false);
  });

  it('writes its own pid to the pid file and execs tmux attach -t =agent', async () => {
    const t = setup();
    const child = spawn('bash', [join(bin, 'agentdesk-attach'), ID], { env: t.env });
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => resolve());
    });
    const pid = readFileSync(join(t.runDir, 'attach', `${ID}.pid`), 'utf8').trim();
    expect(pid).toBe(String(child.pid));
    expect(t.calls()).toContainEqual(['attach', '-t', '=agent']);
  });

  it.each(['../../etc', '$(id)', 'x', `${ID}/../x`, `${ID}\n`, ID.toUpperCase()])(
    'rejects %j with exit 2 and writes nothing',
    (bad) => {
      const t = setup();
      expect(run('agentdesk-attach', bad, t.env).status).toBe(2);
      expect(existsSync(t.runDir) ? readdirSync(t.runDir) : []).toEqual([]);
      expect(t.calls()).toEqual([]);
    },
  );
});

describe('agentdesk-detach', () => {
  const pidFile = (t: ReturnType<typeof setup>, id: string, content: string) => {
    mkdirSync(join(t.runDir, 'attach'), { recursive: true });
    writeFileSync(join(t.runDir, 'attach', `${id}.pid`), content);
  };
  const fakeProc = (t: ReturnType<typeof setup>, pid: number, comm: string) => {
    mkdirSync(join(t.procDir, String(pid)));
    writeFileSync(join(t.procDir, String(pid), 'comm'), `${comm}\n`);
  };
  const sleeper = () => spawn('sleep', ['60'], { stdio: 'ignore' });
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('rejects a non-uuid with exit 2', () => {
    const t = setup();
    expect(run('agentdesk-detach', '../../etc', t.env).status).toBe(2);
    expect(run('agentdesk-detach', '$(id)', t.env).status).toBe(2);
  });

  it('exits 0 when there is no pid file', () => {
    const t = setup();
    expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
  });

  it('kills only the pid in its own file, and removes that file', async () => {
    const t = setup();
    const a = sleeper();
    const b = sleeper();
    try {
      const closed = new Promise<void>((r) => a.on('close', () => r()));
      fakeProc(t, a.pid as number, 'tmux');
      fakeProc(t, b.pid as number, 'tmux');
      pidFile(t, ID, `${a.pid}\n`);
      pidFile(t, OTHER, `${b.pid}\n`);
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      await closed;
      expect(alive(b.pid as number)).toBe(true);
      expect(existsSync(join(t.runDir, 'attach', `${ID}.pid`))).toBe(false);
      expect(existsSync(join(t.runDir, 'attach', `${OTHER}.pid`))).toBe(true);
    } finally {
      a.kill('SIGKILL');
      b.kill('SIGKILL');
    }
  });

  it.each(['tmux: client', 'tmux'])('kills a pid whose comm is %j (a real attach client)', async (comm) => {
    const t = setup();
    const a = sleeper();
    try {
      const closed = new Promise<void>((r) => a.on('close', () => r()));
      fakeProc(t, a.pid as number, comm);
      pidFile(t, ID, `${a.pid}\n`);
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      await closed;
      expect(existsSync(join(t.runDir, 'attach', `${ID}.pid`))).toBe(false);
    } finally {
      a.kill('SIGKILL');
    }
  });

  it.each(['tmux: server', 'sleep', 'bash', 'node', 'tmux: clientx'])(
    'does not kill a pid whose comm is %j',
    (comm) => {
      const t = setup();
      const a = sleeper();
      try {
        fakeProc(t, a.pid as number, comm);
        pidFile(t, ID, `${a.pid}\n`);
        expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
        expect(alive(a.pid as number)).toBe(true);
        expect(existsSync(join(t.runDir, 'attach', `${ID}.pid`))).toBe(false);
      } finally {
        a.kill('SIGKILL');
      }
    },
  );

  it.each(['agentdesk-attach', 'agentdesk-detach'])(
    '%s pins its own C locale so the id ranges are not collation-based',
    (script) => {
      const t = setup();
      const r = run(script, ID.toUpperCase(), { ...t.env, LC_ALL: 'en_US.UTF-8' });
      expect(r.status).toBe(2);
      expect(t.calls()).toEqual([]);
    },
  );

  it.each(['', 'abc', '-1', '0', '1', '12 34', '1; id', '007x'])('ignores the bad pid file content %j', (content) => {
    const t = setup();
    fakeProc(t, 1, 'tmux');
    fakeProc(t, 0, 'tmux');
    pidFile(t, ID, content);
    const r = run('agentdesk-detach', ID, t.env);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/No such process|Operation not permitted/);
    expect(existsSync(join(t.runDir, 'attach', `${ID}.pid`))).toBe(false);
  });
});
