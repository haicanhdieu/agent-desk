import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Drives scripts/runner-serena.sh with a controlled PATH (stub uname/curl/sha256sum/claude, a fake uv inside a fake
// release tarball) and a tmp HOME. No network and no real uv, serena or claude are used.
const script = resolve(__dirname, 'runner-serena.sh');
const ARGS = 'start-mcp-server --context claude-code --agent-interface tools --project';

let dir: string;
let repo: string;
let bin: string;
let sys: string;
let log: string;
let state: string;
let serenaBin: string;

const SYSTEM_TOOLS = [
  'mktemp',
  'rm',
  'mkdir',
  'tar',
  'gzip', // tar -z shells out to gzip; CI's Linux tar has no built-in decompressor
  'install',
  'grep',
  'cut',
  'dirname',
  'git',
  'cat',
  'head',
  'cp',
  'shasum',
  'chmod',
  'bash',
  'node',
  'mv',
];
const which = (tool: string): string =>
  spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
const BASH = which('bash');

// The fake serena: logs its calls, and `project create <path> --language <l>` writes <path>/.serena/project.yml.
const FAKE_SERENA = [
  '#!/bin/sh',
  'echo "serena $*" >> "$LOG"',
  'if [ "$1 $2" = "project create" ]; then mkdir -p "$3/.serena"; echo "language_servers: [$5]" > "$3/.serena/project.yml"; fi',
].join('\n');

function stub(name: string, body: string, where = bin): void {
  writeFileSync(join(where, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(where, name), 0o755);
}

// A uv release tarball holding a fake uv (reports the pin; `tool install` drops a fake serena and serena-hooks) and uvx.
function buildUvTarball(): string {
  const name = 'uv-x86_64-unknown-linux-gnu';
  const root = join(dir, 'tarball');
  mkdirSync(join(root, name), { recursive: true });
  const uv = [
    '#!/bin/sh',
    'echo "uv $*" >> "$LOG"',
    'case "$1" in',
    '  --version) echo "uv 0.9.28 (abc1234 2026-01-29)" ;;',
    '  tool) if [ "$2" = dir ]; then echo "$HOME/.local/bin"; exit 0; fi; if [ "$2" = list ]; then [ -f "$HOME/.local/bin/serena" ] && echo "serena-agent v2.1.0"; exit 0; fi; cp "$FAKE_SERENA_FILE" "$HOME/.local/bin/serena"; chmod +x "$HOME/.local/bin/serena"; cp "$HOME/.local/bin/serena" "$HOME/.local/bin/serena-hooks" ;;',
    'esac',
  ].join('\n');
  writeFileSync(join(root, name, 'uv'), `${uv}\n`);
  writeFileSync(join(root, name, 'uvx'), '#!/bin/sh\nexit 0\n');
  const tgz = join(dir, 'uv.tar.gz');
  spawnSync('tar', ['-czf', tgz, '-C', root, name], { encoding: 'utf8' });
  return tgz;
}

const pinnedSha = (): string =>
  /x86_64 \| amd64\)[\s\S]*?UV_SHA256=([0-9a-f]{64})/.exec(readFileSync(script, 'utf8'))?.[1] ?? '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-serena-'));
  repo = join(realpathSync(dir), 'repo');
  bin = join(dir, 'bin');
  sys = join(dir, 'sys');
  state = join(dir, 'state');
  log = join(dir, 'calls.log');
  serenaBin = join(dir, '.local', 'bin', 'serena');
  for (const d of [repo, bin, sys, state, join(dir, '.local', 'bin')]) mkdirSync(d, { recursive: true });
  writeFileSync(log, '');
  writeFileSync(join(dir, 'fake-serena'), `${FAKE_SERENA}\n`);
  for (const tool of SYSTEM_TOOLS) if (which(tool) !== '') symlinkSync(which(tool), join(sys, tool));
  spawnSync('git', ['init', '-q', repo]);
  stub('uname', 'if [ "$1" = -m ]; then echo x86_64; else echo Linux; fi');
  stub(
    'curl',
    'echo "curl $*" >> "$LOG"; while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done; cp "$SERVE" "$out"',
  );
  // The pinned hash can only match the real release, so a fake sha256sum reports it unless a test wants the real one.
  stub(
    'sha256sum',
    'if [ -n "${FAKE_SHA:-}" ]; then echo "$FAKE_SHA  $1"; else export PATH=/usr/bin:/bin:$PATH; /usr/bin/sha256sum "$1" 2>/dev/null || shasum -a 256 "$1"; fi',
  );
  stub(
    'claude',
    [
      'echo "claude $*" >> "$LOG"',
      'reg="$STATE/registered"',
      'case "$2" in',
      '  get) [ -f "$reg" ] || exit 1; read -r cmd args < "$reg"; printf "serena:\\n  Scope: Local config\\n  Command: %s\\n  Args: %s\\n" "$cmd" "$args" ;;',
      '  add) shift 6; echo "$*" > "$reg" ;;',
      '  remove) rm -f "$reg" ;;',
      'esac',
    ].join('\n'),
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(env: Record<string, string | undefined> = { RUNNER_ENABLE_SERENA: '1' }): {
  status: number | null;
  out: string;
  err: string;
} {
  const merged: Record<string, string> = {
    PATH: `${bin}:${sys}`,
    HOME: dir,
    LOG: log,
    STATE: state,
    SERVE: join(dir, 'uv.tar.gz'),
    FAKE_SERENA_FILE: join(dir, 'fake-serena'),
    FAKE_SHA: pinnedSha(),
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const r = spawnSync(BASH, [script], { cwd: repo, encoding: 'utf8', env: merged });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

const calls = (): string[] =>
  readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => l !== '');
const count = (prefix: string): number => calls().filter((l) => l.startsWith(prefix)).length;
const exclude = (): string => readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');

describe('runner-serena.sh', () => {
  beforeEach(() => {
    buildUvTarball();
  });

  it.each([undefined, '0'])('does nothing when RUNNER_ENABLE_SERENA is %s', (value) => {
    const r = run({ RUNNER_ENABLE_SERENA: value });
    expect(r.status).toBe(0);
    expect(r.out + r.err).toBe('');
    expect(calls()).toEqual([]);
    expect(existsSync(join(dir, '.local', 'bin', 'uv'))).toBe(false);
    expect(existsSync(join(repo, '.claude'))).toBe(false);
  });

  it('rejects an invalid RUNNER_ENABLE_SERENA with exit 64', () => {
    const r = run({ RUNNER_ENABLE_SERENA: 'yes' });
    expect(r.status).toBe(64);
    expect(r.err).toContain('RUNNER_ENABLE_SERENA must be unset, 0 or 1');
    expect(calls()).toEqual([]);
  });

  it('installs uv and serena and registers with the exact args', () => {
    const r = run();
    expect([r.status, r.err]).toEqual([0, '']);
    expect(r.out).toContain('==> runner-serena:');
    expect(count('curl')).toBe(1);
    expect(calls().find((l) => l.startsWith('curl'))).toContain('--proto =https --tlsv1.2');
    expect(calls()).toContain('uv tool install --python 3.12 serena-agent==2.1.0');
    expect(calls()).toContain(`claude mcp add --scope local serena -- ${serenaBin} ${ARGS} ${repo}`);
  });

  it('is a no-op on the second run', () => {
    run();
    writeFileSync(log, '');
    const r = run();
    expect(r.status).toBe(0);
    expect(
      calls().filter(
        (l) =>
          !l.startsWith('claude mcp get') && l !== 'uv --version' && l !== 'uv tool list' && l !== 'uv tool dir --bin',
      ),
    ).toEqual([]);
  });

  it('does not register twice when already registered for this path', () => {
    writeFileSync(join(state, 'registered'), `${serenaBin} ${ARGS} ${repo}\n`);
    run();
    expect(count('claude mcp add')).toBe(0);
    expect(count('claude mcp remove')).toBe(0);
  });

  it('removes and re-adds when registered for a different path', () => {
    writeFileSync(join(state, 'registered'), `${serenaBin} ${ARGS} /somewhere/else\n`);
    run();
    expect(calls()).toContain('claude mcp remove --scope local serena');
    expect(count('claude mcp add')).toBe(1);
    expect(readFileSync(join(state, 'registered'), 'utf8').trim()).toBe(`${serenaBin} ${ARGS} ${repo}`);
  });

  it('replaces a stale registration that uses the bare serena command', () => {
    writeFileSync(join(state, 'registered'), `serena ${ARGS} ${repo}\n`);
    run();
    expect(calls()).toContain('claude mcp remove --scope local serena');
    expect(count('claude mcp add')).toBe(1);
    expect(readFileSync(join(state, 'registered'), 'utf8').trim()).toBe(`${serenaBin} ${ARGS} ${repo}`);
  });

  // A uv already in ~/.local/bin reporting the given versions (null = no serena-agent installed).
  function preinstalled(uvVersion: string, serenaVersion: string | null): void {
    stub(
      'uv',
      [
        'echo "uv $*" >> "$LOG"',
        'case "$1" in',
        `  --version) echo "uv ${uvVersion} (abc1234 2026-01-29)" ;;`,
        `  tool) if [ "$2" = dir ]; then echo "$HOME/.local/bin"; elif [ "$2" = list ]; then ${
          serenaVersion === null ? ':' : `echo "serena-agent v${serenaVersion}"`
        }; fi ;;`,
        'esac',
      ].join('\n'),
      join(dir, '.local', 'bin'),
    );
    stub('serena-hooks', 'exit 0', join(dir, '.local', 'bin'));
    stub('serena', FAKE_SERENA.split('\n').slice(1).join('\n'), join(dir, '.local', 'bin'));
  }

  it('downloads uv again when the installed uv is not the pin', () => {
    preinstalled('0.9.27', '2.1.0');
    const r = run();
    expect(r.status).toBe(0);
    expect(count('curl')).toBe(1);
  });

  it('keeps an installed uv that is at the pin', () => {
    preinstalled('0.9.28', '2.1.0');
    run();
    expect(count('curl')).toBe(0);
    expect(count('uv tool install')).toBe(0);
  });

  it('reinstalls serena-agent when the installed version is not the pin', () => {
    preinstalled('0.9.28', '2.0.0');
    run();
    expect(calls()).toContain('uv tool install --python 3.12 serena-agent==2.1.0');
  });

  it('refuses a uv download whose sha256 does not match the pin', () => {
    writeFileSync(join(dir, 'uv.tar.gz'), 'not the real release');
    const r = run({ RUNNER_ENABLE_SERENA: '1', FAKE_SHA: undefined });
    expect(r.status).toBe(1);
    expect(r.err).toContain('sha256 mismatch');
    expect(count('uv ')).toBe(0);
    expect(count('claude mcp add')).toBe(0);
    expect(existsSync(join(dir, '.local', 'bin', 'uv'))).toBe(false);
  });

  it('skips with exit 0 when claude is not on PATH', () => {
    rmSync(join(bin, 'claude'));
    const r = run();
    expect(r.status).toBe(0);
    expect(r.err).toContain('runner-serena: skipping');
    expect(calls()).toEqual([]);
  });

  it('skips with exit 0 on a non-Linux host', () => {
    stub('uname', 'echo Darwin');
    const r = run();
    expect(r.status).toBe(0);
    expect(r.err).toContain('runner-serena: skipping');
    expect(calls()).toEqual([]);
  });

  describe('language server', () => {
    const projectYml = (): string => join(repo, '.serena', 'project.yml');
    const createCall = (): string => `serena project create ${repo} --language typescript`;

    it('creates the Serena project with the typescript language server', () => {
      const r = run();
      expect([r.status, r.err]).toEqual([0, '']);
      expect(calls()).toContain(createCall());
      expect(readFileSync(projectYml(), 'utf8')).toBe('language_servers: [typescript]\n');
    });

    it('does not create it again when a language server is set', () => {
      run();
      writeFileSync(log, '');
      const r = run();
      expect(r.status).toBe(0);
      expect(r.out).toContain('already configured');
      expect(count('serena ')).toBe(0);
    });

    it('fills in an empty language_servers list that Serena wrote on its own', () => {
      mkdirSync(join(repo, '.serena'), { recursive: true });
      writeFileSync(projectYml(), 'project_name: "repo"\nlanguage_servers: []\nencoding: "utf-8"\n');
      const r = run();
      expect(r.status).toBe(0);
      expect(count('serena project create')).toBe(0);
      expect(readFileSync(projectYml(), 'utf8')).toBe(
        'project_name: "repo"\nlanguage_servers: [typescript]\nencoding: "utf-8"\n',
      );
    });

    it('keeps a language list someone set by hand', () => {
      mkdirSync(join(repo, '.serena'), { recursive: true });
      writeFileSync(projectYml(), 'language_servers: [python]\n');
      run();
      expect(readFileSync(projectYml(), 'utf8')).toBe('language_servers: [python]\n');
    });
  });

  it('adds .serena/ to info/exclude once', () => {
    run();
    run();
    expect(
      exclude()
        .split('\n')
        .filter((l) => l === '.serena/'),
    ).toHaveLength(1);
  });

  describe('Claude Code hooks', () => {
    let localFile: string;

    beforeEach(() => {
      localFile = join(repo, '.claude', 'settings.local.json');
    });

    const writeClaudeFile = (path: string, text: string): void => {
      mkdirSync(join(repo, '.claude'), { recursive: true });
      writeFileSync(path, text);
    };
    const settings = (): unknown => JSON.parse(readFileSync(localFile, 'utf8'));
    const cmd = (n: string): string => `'${join(dir, '.local', 'bin', 'serena-hooks')}' ${n} --client=claude-code`;
    const entry = (command: string) => ({ type: 'command', command });
    const group = (matcher: string, n: string) => ({ matcher, hooks: [entry(cmd(n))] });
    const expected = () => ({
      PreToolUse: [group('', 'remind'), group('mcp__serena__*', 'auto-approve')],
      SessionStart: [group('', 'activate')],
      SessionEnd: [group('', 'cleanup')],
    });
    // Every hook command in the file, whatever event or group holds it.
    const commands = (): string[] => {
      const found: string[] = [];
      JSON.parse(readFileSync(localFile, 'utf8'), (key, value: unknown) => {
        if (key === 'command') found.push(String(value));
        return value;
      });
      return found;
    };

    it('writes the four Serena hooks to settings.local.json', () => {
      const r = run();
      expect([r.status, r.err]).toEqual([0, '']);
      expect(r.out).toContain('==> runner-serena: hooks (.claude/settings.local.json)');
      expect(settings()).toEqual({ hooks: expected() });
      expect(readFileSync(localFile, 'utf8')).toBe(`${JSON.stringify(settings(), null, 2)}\n`);
    });

    it('never touches settings.json', () => {
      const shared = join(repo, '.claude', 'settings.json');
      writeClaudeFile(shared, '{"enabledPlugins":{}}');
      expect(run().status).toBe(0);
      expect(readFileSync(shared, 'utf8')).toBe('{"enabledPlugins":{}}');
    });

    it('keeps other settings and hooks, without duplicates on rerun', () => {
      const stop = [{ matcher: '', hooks: [entry('stop-it')] }];
      const mine = { matcher: '', hooks: [entry('mine')] };
      writeClaudeFile(localFile, JSON.stringify({ model: 'x', hooks: { Stop: stop, PreToolUse: [mine] } }));
      expect(run().status).toBe(0);
      expect(run().status).toBe(0);
      expect(settings()).toEqual({
        model: 'x',
        hooks: { ...expected(), Stop: stop, PreToolUse: [mine, ...expected().PreToolUse] },
      });
    });

    it('replaces a hook that points to an old path, keeping its neighbour', () => {
      const old = { matcher: '', hooks: [entry('/old/serena-hooks remind --client=claude-code'), entry('mine')] };
      writeClaudeFile(localFile, JSON.stringify({ hooks: { PreToolUse: [old] } }));
      expect(run().status).toBe(0);
      expect(commands().filter((c) => c.includes('/old/'))).toEqual([]);
      expect(commands()).toContain('mine');
      expect(commands().filter((c) => c.includes(' remind --client=claude-code'))).toEqual([cmd('remind')]);
    });

    it('treats an empty settings.local.json as {}', () => {
      writeClaudeFile(localFile, '  \n');
      expect(run().status).toBe(0);
      expect(settings()).toEqual({ hooks: expected() });
    });

    it.each(['{oops', '[]', '{"hooks":[]}', '{"hooks":{"PreToolUse":{}}}'])(
      'fails and leaves the file untouched: %s',
      (text) => {
        writeClaudeFile(localFile, text);
        const r = run();
        expect(r.status).not.toBe(0);
        expect(r.err).toContain('runner-serena:');
        expect(r.err).toContain('settings.local.json');
        expect(readFileSync(localFile, 'utf8')).toBe(text);
      },
    );

    it('quotes a hooks path that contains a space', () => {
      const home = join(dir, 'a home');
      mkdirSync(join(home, '.local', 'bin'), { recursive: true });
      expect(run({ RUNNER_ENABLE_SERENA: '1', HOME: home }).status).toBe(0);
      const remind = commands().find((c) => c.includes(' remind '));
      expect(remind?.startsWith(`'${join(home, '.local', 'bin', 'serena-hooks')}' `)).toBe(true);
    });

    it('fails when serena-hooks is missing', () => {
      preinstalled('0.9.28', '2.1.0');
      rmSync(join(dir, '.local', 'bin', 'serena-hooks'));
      const r = run();
      expect(r.status).not.toBe(0);
      expect(r.err).toContain('serena-hooks');
      expect(r.err).toContain('uv tool install --reinstall --python 3.12 serena-agent==2.1.0');
      expect(r.err).toContain('bump the pin');
      expect(r.err).toContain('A plain rerun does not repair it');
      expect(existsSync(localFile)).toBe(false);
    });
  });
});

describe('runner-setup.sh', () => {
  it('rejects an invalid RUNNER_ENABLE_SERENA with exit 64 before installing anything', () => {
    const setup = resolve(__dirname, 'runner-setup.sh');
    const r = spawnSync(BASH, [setup], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: `${bin}:${sys}`, HOME: dir, LOG: log, RUNNER_ENABLE_SERENA: 'bogus' },
    });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('RUNNER_ENABLE_SERENA must be unset, 0 or 1');
    expect(r.stdout).toBe('');
    expect(calls()).toEqual([]);
    expect(existsSync(join(dir, '.local', 'bin', 'corepack'))).toBe(false);
  });
});

describe('runner-setup.sh wiring', () => {
  const setup = resolve(__dirname, 'runner-setup.sh');
  let proj: string;

  beforeEach(() => {
    proj = join(dir, 'proj');
    mkdirSync(join(proj, 'scripts'), { recursive: true });
    writeFileSync(join(proj, 'package.json'), '{"packageManager":"pnpm@10.0.0"}');
    writeFileSync(join(proj, '.env.example'), '');
    stub('node', 'case "$1" in -p) echo 10.0.0 ;; esac');
    stub('corepack', 'exit 0');
    stub('pnpm', 'echo "pnpm $*" >> "$LOG"');
    writeFileSync(join(proj, 'scripts', 'runner-serena.sh'), '#!/bin/sh\necho "serena-script" >> "$LOG"\n');
  });

  const setupCalls = (): string[] => calls().filter((l) => l === 'serena-script' || l.startsWith('pnpm install'));

  function runSetup(env: Record<string, string>): { status: number | null; out: string } {
    const r = spawnSync(BASH, [setup], {
      cwd: proj,
      encoding: 'utf8',
      env: { PATH: `${bin}:${sys}`, HOME: dir, LOG: log, RUNNER_SETUP_PROFILE: 'minimal', ...env },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  }

  it('runs runner-serena.sh after the dependencies and before the minimal early exit', () => {
    const r = runSetup({ RUNNER_ENABLE_SERENA: '1' });
    expect(r.status).toBe(0);
    expect(setupCalls()).toEqual(['pnpm install --frozen-lockfile', 'serena-script']);
    expect(r.out.indexOf('Serena (opt-in)')).toBeLessThan(r.out.indexOf('Ready (minimal)'));
  });

  it.each(['0', ''])('does not run runner-serena.sh when the flag is %j', (value) => {
    const r = runSetup(value === '' ? {} : { RUNNER_ENABLE_SERENA: value });
    expect(r.status).toBe(0);
    expect(setupCalls()).toEqual(['pnpm install --frozen-lockfile']);
  });

  it('rejects an invalid flag before installing anything', () => {
    const r = runSetup({ RUNNER_ENABLE_SERENA: 'bogus' });
    expect(r.status).toBe(64);
    expect(calls()).toEqual([]);
  });
});
