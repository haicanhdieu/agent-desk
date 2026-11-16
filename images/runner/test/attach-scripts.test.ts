import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
  // process.kill(pid, 0) also succeeds on a killed-but-unreaped zombie, so decide by how the child really ended:
  // 'SIGTERM' means detach signalled it, 'SIGKILL' means only our own cleanup did.
  const endSignal = async (child: ChildProcess, closed: Promise<void>) => {
    child.kill('SIGKILL');
    await closed;
    return child.signalCode;
  };
  const watch = (child: ChildProcess) => new Promise<void>((r) => child.on('close', () => r()));
  const pidPath = (t: ReturnType<typeof setup>, id: string) => join(t.runDir, 'attach', `${id}.pid`);

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
    const aClosed = watch(a);
    const bClosed = watch(b);
    try {
      fakeProc(t, a.pid as number, 'tmux: client');
      fakeProc(t, b.pid as number, 'tmux: client');
      pidFile(t, ID, `${a.pid}\n`);
      pidFile(t, OTHER, `${b.pid}\n`);
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      expect(await endSignal(a, aClosed)).toBe('SIGTERM');
      expect(await endSignal(b, bClosed)).toBe('SIGKILL');
      expect(existsSync(pidPath(t, ID))).toBe(false);
      expect(existsSync(pidPath(t, OTHER))).toBe(true);
    } finally {
      a.kill('SIGKILL');
      b.kill('SIGKILL');
    }
  });

  it.each(['tmux: client', 'agentdesk-attac'])('kills a pid whose comm is %j', async (comm) => {
    const t = setup();
    const a = sleeper();
    const closed = watch(a);
    try {
      fakeProc(t, a.pid as number, comm);
      pidFile(t, ID, `${a.pid}\n`);
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      expect(await endSignal(a, closed)).toBe('SIGTERM');
      expect(existsSync(pidPath(t, ID))).toBe(false);
    } finally {
      a.kill('SIGKILL');
    }
  });

  it.each(['tmux: server', 'tmux', 'sleep', 'bash', 'node', 'tmux: clientx'])(
    'does not kill a pid whose comm is %j',
    async (comm) => {
      const t = setup();
      const a = sleeper();
      const closed = watch(a);
      try {
        fakeProc(t, a.pid as number, comm);
        pidFile(t, ID, `${a.pid}\n`);
        expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
        expect(await endSignal(a, closed)).toBe('SIGKILL');
        expect(existsSync(pidPath(t, ID))).toBe(false);
      } finally {
        a.kill('SIGKILL');
      }
    },
  );

  describe('detach arriving before attach', () => {
    it('leaves a tombstone, and the later attach exits 3 without attaching', () => {
      const t = setup();
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      expect(readFileSync(pidPath(t, ID), 'utf8')).toBe('-\n');
      expect(run('agentdesk-attach', ID, t.env).status).toBe(3);
      expect(t.calls().some((a) => a.includes('attach'))).toBe(false);
      expect(existsSync(pidPath(t, ID))).toBe(false);
    });

    it('is idempotent: a second detach keeps the tombstone', () => {
      const t = setup();
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      expect(readFileSync(pidPath(t, ID), 'utf8')).toBe('-\n');
      expect(run('agentdesk-attach', ID, t.env).status).toBe(3);
    });

    it('does not block an attach with a different id', async () => {
      const t = setup();
      expect(run('agentdesk-detach', ID, t.env).status).toBe(0);
      const child = spawn('bash', [join(bin, 'agentdesk-attach'), OTHER], { env: t.env });
      await watch(child);
      expect(child.exitCode).toBe(0);
      expect(t.calls()).toContainEqual(['attach', '-t', '=agent']);
    });

    it('never follows a symlink planted at the pid file path', () => {
      const t = setup();
      const victim = join(t.dir, 'victim');
      writeFileSync(victim, 'keep');
      mkdirSync(join(t.runDir, 'attach'), { recursive: true });
      symlinkSync(victim, pidPath(t, ID));
      expect(run('agentdesk-attach', ID, t.env).status).toBe(3);
      expect(readFileSync(victim, 'utf8')).toBe('keep');
    });
  });

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

describe('agentdesk-end', () => {
  const end = (env: Record<string, string>, ...args: string[]) =>
    spawnSync('bash', [join(bin, 'agentdesk-end'), ...args], { env, encoding: 'utf8' });

  it('creates the stop file, creating the run dir when it does not exist yet, and exits 0', () => {
    const t = setup();
    expect(end(t.env).status).toBe(0);
    expect(readdirSync(t.runDir)).toEqual(['stop']);
  });

  it('is idempotent', () => {
    const t = setup();
    expect(end(t.env).status).toBe(0);
    expect(end(t.env).status).toBe(0);
    expect(readdirSync(t.runDir)).toEqual(['stop']);
  });

  it.each([['extra'], [''], ['../../etc', 'x']])('accepts no arguments: %j exits 2 and writes nothing', (...args) => {
    const t = setup();
    const r = end(t.env, ...args);
    expect(r.status).toBe(2);
    expect(existsSync(t.runDir) ? readdirSync(t.runDir) : []).toEqual([]);
  });

  it('never follows a link planted at the stop path: the link is replaced, its target untouched', () => {
    const t = setup();
    mkdirSync(t.runDir, { recursive: true });
    const target = join(t.dir, 'elsewhere');
    writeFileSync(target, 'keep');
    symlinkSync(target, join(t.runDir, 'stop'));
    expect(end(t.env).status).toBe(0);
    expect(lstatSync(join(t.runDir, 'stop')).isFile()).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('keep');
  });

  it('never descends into a link to a directory planted at the stop path (GNU mv would put the file inside it)', () => {
    const t = setup();
    mkdirSync(t.runDir, { recursive: true });
    const target = join(t.dir, 'somedir');
    mkdirSync(target);
    symlinkSync(target, join(t.runDir, 'stop'));
    expect(end(t.env).status).toBe(0);
    expect(lstatSync(join(t.runDir, 'stop')).isFile()).toBe(true);
    expect(readdirSync(target)).toEqual([]);
    expect(readdirSync(t.runDir)).toEqual(['stop']);
  });

  it('a real directory at the stop path is left alone and no temporary file is left inside or beside it', () => {
    const t = setup();
    mkdirSync(join(t.runDir, 'stop'), { recursive: true });
    expect(end(t.env).status).toBe(0);
    expect(readdirSync(join(t.runDir, 'stop'))).toEqual([]);
    expect(readdirSync(t.runDir)).toEqual(['stop']);
  });
});

describe('agentdesk-session', () => {
  const session = (env: Record<string, string>, ...args: string[]) =>
    spawnSync('bash', [join(bin, 'agentdesk-session'), ...args], { env, encoding: 'utf8' });
  const exitFile = (t: ReturnType<typeof setup>) => join(t.runDir, 'agent-exit');

  it.each([
    ['exit 0', 0],
    ['exit 5', 5],
    ['exit 255', 255],
  ])('runs the command %j and writes its exit code to agent-exit, exiting with it', (cmd, code) => {
    const t = setup();
    const r = session(t.env, cmd);
    expect(r.status).toBe(code);
    expect(readFileSync(exitFile(t), 'utf8').trim()).toBe(String(code));
  });

  it('writes 128+n when the agent is killed by a signal', () => {
    const t = setup();
    const r = session(t.env, 'kill -KILL $$');
    expect(r.status).toBe(137);
    expect(readFileSync(exitFile(t), 'utf8').trim()).toBe('137');
  });

  it('runs the command with the environment it was given, and exec replaces the shell like tmux did', () => {
    const t = setup();
    const r = session({ ...t.env, PROMPT: 'p', CODE: '7' }, 'test "$PROMPT" = p && exec bash -c "exit \\$CODE"');
    expect(r.status).toBe(7);
    expect(readFileSync(exitFile(t), 'utf8').trim()).toBe('7');
  });

  it('writes atomically: no temporary file is left, and an older file (or a link) is replaced, not followed', () => {
    const t = setup();
    mkdirSync(t.runDir, { recursive: true });
    const target = join(t.dir, 'elsewhere');
    writeFileSync(target, 'keep');
    symlinkSync(target, exitFile(t));
    expect(session(t.env, 'exit 2').status).toBe(2);
    expect(readdirSync(t.runDir)).toEqual(['agent-exit']);
    expect(lstatSync(exitFile(t)).isFile()).toBe(true);
    expect(readFileSync(exitFile(t), 'utf8').trim()).toBe('2');
    expect(readFileSync(target, 'utf8')).toBe('keep');
  });

  it('never descends into a link to a directory planted at the agent-exit path', () => {
    const t = setup();
    mkdirSync(t.runDir, { recursive: true });
    const target = join(t.dir, 'somedir');
    mkdirSync(target);
    symlinkSync(target, exitFile(t));
    expect(session(t.env, 'exit 3').status).toBe(3);
    expect(lstatSync(exitFile(t)).isFile()).toBe(true);
    expect(readFileSync(exitFile(t), 'utf8').trim()).toBe('3');
    expect(readdirSync(target)).toEqual([]);
    expect(readdirSync(t.runDir)).toEqual(['agent-exit']);
  });

  it('a real directory at the agent-exit path is left alone, nothing is left inside it, and the exit code still passes on', () => {
    const t = setup();
    mkdirSync(exitFile(t), { recursive: true });
    expect(session(t.env, 'exit 4').status).toBe(4);
    expect(readdirSync(exitFile(t))).toEqual([]);
    expect(readdirSync(t.runDir)).toEqual(['agent-exit']);
  });

  // The agent and the setup_test login shell must see the caller's locale, not one forced by this script.
  it.each([['en_US.UTF-8'], ['C.UTF-8'], [undefined]])(
    'the command sees LC_ALL=%s exactly as the caller had it',
    (lc) => {
      const t = setup();
      const out = join(t.dir, 'lc.out');
      const env: Record<string, string> = { ...t.env, OUT: out };
      if (lc !== undefined) env.LC_ALL = lc;
      expect(session(env, 'printf "%s" "${LC_ALL-UNSET}" > "$OUT"').status).toBe(0);
      expect(readFileSync(out, 'utf8')).toBe(lc ?? 'UNSET');
    },
  );

  it.each([[[]], [['']], [['exit 0', 'extra']]])('needs exactly one command: %j exits 2 and writes nothing', (args) => {
    const t = setup();
    expect(session(t.env, ...args).status).toBe(2);
    expect(existsSync(t.runDir) ? readdirSync(t.runDir) : []).toEqual([]);
  });

  it('still writes the code when its whole process group gets SIGTERM (what tmux does to a pane)', async () => {
    const t = setup();
    // The agent is started in the background BEFORE `ready` is printed, so it is certainly a member of the group when
    // the signal is sent (a command forked at the moment of a group kill can be missed and then outlives it, holding the
    // output pipe open). A new process group, so signalling it never touches the test runner.
    const child = spawn('bash', [join(bin, 'agentdesk-session'), 'sleep 60 & echo ready; wait'], {
      env: t.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // The process ends with its code; wait for that, not for the output pipe to close.
    const ended = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    let seen = '';
    await new Promise<void>((resolve) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        seen += chunk.toString();
        if (seen.split('\n').includes('ready')) resolve();
      });
    });
    try {
      process.kill(-(child.pid as number), 'SIGTERM');
      expect(await ended).toBe(143);
      expect(readFileSync(exitFile(t), 'utf8').trim()).toBe('143');
    } finally {
      try {
        process.kill(-(child.pid as number), 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });
});
