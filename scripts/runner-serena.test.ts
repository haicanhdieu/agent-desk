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

const SYSTEM_TOOLS = [
  'mktemp',
  'rm',
  'mkdir',
  'tar',
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
];
const which = (tool: string): string =>
  spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
const BASH = which('bash');

function stub(name: string, body: string, where = bin): void {
  writeFileSync(join(where, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(where, name), 0o755);
}

// A uv release tarball holding a fake uv (reports the pin; `tool install` drops a fake serena) and uvx.
function buildUvTarball(): string {
  const name = 'uv-x86_64-unknown-linux-gnu';
  const root = join(dir, 'tarball');
  mkdirSync(join(root, name), { recursive: true });
  const uv = [
    '#!/bin/sh',
    'echo "uv $*" >> "$LOG"',
    'case "$1" in',
    '  --version) echo "uv 0.9.28" ;;',
    '  tool) printf "#!/bin/sh\\necho serena 2.1.0\\n" > "$HOME/.local/bin/serena"; chmod +x "$HOME/.local/bin/serena" ;;',
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
  for (const d of [repo, bin, sys, state, join(dir, '.local', 'bin')]) mkdirSync(d, { recursive: true });
  writeFileSync(log, '');
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
      '  get) [ -f "$reg" ] || exit 1; printf "serena:\\n  Scope: Local config\\n  Args: %s\\n" "$(cat "$reg")" ;;',
      '  add) shift 7; echo "$*" > "$reg" ;;',
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
    expect(calls()).toContain(`claude mcp add --scope local serena -- serena ${ARGS} ${repo}`);
  });

  it('is a no-op on the second run', () => {
    run();
    writeFileSync(log, '');
    const r = run();
    expect(r.status).toBe(0);
    expect(calls().filter((l) => !l.startsWith('claude mcp get') && l !== 'uv --version')).toEqual([]);
  });

  it('does not register twice when already registered for this path', () => {
    writeFileSync(join(state, 'registered'), `${ARGS} ${repo}\n`);
    run();
    expect(count('claude mcp add')).toBe(0);
    expect(count('claude mcp remove')).toBe(0);
  });

  it('removes and re-adds when registered for a different path', () => {
    writeFileSync(join(state, 'registered'), `${ARGS} /somewhere/else\n`);
    run();
    expect(calls()).toContain('claude mcp remove --scope local serena');
    expect(count('claude mcp add')).toBe(1);
    expect(readFileSync(join(state, 'registered'), 'utf8').trim()).toBe(`${ARGS} ${repo}`);
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

  it('adds .serena/ to info/exclude once', () => {
    run();
    run();
    expect(
      exclude()
        .split('\n')
        .filter((l) => l === '.serena/'),
    ).toHaveLength(1);
  });
});
