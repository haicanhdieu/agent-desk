import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const runnerDir = join(import.meta.dirname, '..');

export interface EntrypointResult {
  stdout: string[];
  exitCode: number;
  calls: { cmd: string; argv: string[] }[];
}

/**
 * Runs images/runner/entrypoint.sh with git/claude/tmux/timeout replaced by stubs that log their argv to $STUB_LOG.
 * `repoFixture` maps repo-relative paths to file contents; the git stub's clone writes them. No network is used.
 */
export async function runEntrypoint(
  env: Record<string, string>,
  repoFixture: Record<string, string>,
): Promise<EntrypointResult> {
  const dir = await mkdtemp(join(tmpdir(), 'entrypoint-'));
  const stubLog = join(dir, 'stub.log');
  const fixture = join(dir, 'fixture.json');
  await writeFile(stubLog, '');
  await writeFile(fixture, JSON.stringify(repoFixture));
  const fullEnv: Record<string, string> = {
    PATH: [join(import.meta.dirname, 'stubs'), dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
    HOME: dir,
    STUB_LOG: stubLog,
    STUB_FIXTURE: fixture,
    AGENTDESK_REPO_DIR: join(dir, 'repo'),
    AGENTDESK_LIB_DIR: runnerDir,
    REPO_CLONE_URL: 'https://example.invalid/o/r.git',
    PROMPT: 'do the thing',
    ...env,
  };
  const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number }>((resolve, reject) => {
    execFile('bash', [join(runnerDir, 'entrypoint.sh')], { env: fullEnv, timeout: 30_000 }, (err, out) => {
      if (err && typeof err.code !== 'number') reject(err);
      else resolve({ stdout: out, exitCode: typeof err?.code === 'number' ? err.code : 0 });
    });
  });
  const calls = (await readFile(stubLog, 'utf8'))
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as { cmd: string; argv: string[] });
  return { stdout: stdout.split('\n').filter((l) => l !== ''), exitCode, calls };
}
