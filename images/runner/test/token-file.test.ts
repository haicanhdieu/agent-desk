import { execFile } from 'node:child_process';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEntrypoint } from './harness.js';

const runnerDir = join(import.meta.dirname, '..');
const helper = join(runnerDir, 'git-credential-agentdesk');
const ghWrapperDir = join(runnerDir, 'bin');

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}

function run(cmd: string, args: string[], env: Record<string, string>, stdin = ''): Promise<Out> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { env, timeout: 10_000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') reject(err);
      else resolve({ stdout, stderr, code: typeof err?.code === 'number' ? err.code : 0 });
    });
    child.stdin?.end(stdin);
  });
}

async function tokenFile(content: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'token-'));
  const file = join(dir, 'token');
  await writeFile(file, content);
  return { dir, file };
}

describe('git credential helper', () => {
  const baseEnv = (file: string) => ({
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    AGENTDESK_TOKEN_FILE: file,
    AGENTDESK_GIT_HOST: 'github.com',
  });
  const ask = 'protocol=https\nhost=github.com\n\n';

  it('answers `get` with the username and the token read from the file', async () => {
    const { file } = await tokenFile('tok-one\n');
    const r = await run(helper, ['get'], baseEnv(file), 'protocol=https\nhost=github.com\n\n');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('username=x-access-token\npassword=tok-one\n');
  });

  it('reads the file on every call, so a refreshed token is used without a restart', async () => {
    const { file } = await tokenFile('tok-one');
    await run(helper, ['get'], baseEnv(file), ask);
    await writeFile(file, 'tok-two');
    const r = await run(helper, ['get'], baseEnv(file), ask);
    expect(r.stdout).toBe('username=x-access-token\npassword=tok-two\n');
  });

  it('takes the username from AGENTDESK_GIT_USERNAME', async () => {
    const { file } = await tokenFile('tok');
    const r = await run(helper, ['get'], { ...baseEnv(file), AGENTDESK_GIT_USERNAME: 'oauth2' }, ask);
    expect(r.stdout).toBe('username=oauth2\npassword=tok\n');
  });

  it('prints nothing for store and erase', async () => {
    const { file } = await tokenFile('tok');
    for (const action of ['store', 'erase']) {
      const r = await run(helper, [action], baseEnv(file), 'protocol=https\n\n');
      expect(r).toEqual({ stdout: '', stderr: '', code: 0 });
    }
  });

  it('prints nothing for a host other than AGENTDESK_GIT_HOST (a foreign fetch or submodule URL)', async () => {
    const { file } = await tokenFile('tok');
    const r = await run(helper, ['get'], baseEnv(file), 'protocol=https\nhost=evil.example\n\n');
    expect(r).toEqual({ stdout: '', stderr: '', code: 0 });
    const sub = await run(helper, ['get'], baseEnv(file), 'protocol=https\nhost=github.com.evil.example\n\n');
    expect(sub).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('prints nothing for a non-https protocol, even on the right host', async () => {
    const { file } = await tokenFile('tok');
    const r = await run(helper, ['get'], baseEnv(file), 'protocol=http\nhost=github.com\n\n');
    expect(r).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('compares the host case-insensitively and tolerates CRLF input', async () => {
    const { file } = await tokenFile('tok');
    const r = await run(helper, ['get'], baseEnv(file), 'protocol=https\r\nhost=GitHub.COM\r\n\r\n');
    expect(r.stdout).toBe('username=x-access-token\npassword=tok\n');
  });

  it('prints nothing when the request names no host or no protocol', async () => {
    const { file } = await tokenFile('tok');
    expect(await run(helper, ['get'], baseEnv(file), 'protocol=https\n\n')).toEqual({
      stdout: '',
      stderr: '',
      code: 0,
    });
    expect(await run(helper, ['get'], baseEnv(file), '')).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('fails closed: prints nothing when AGENTDESK_GIT_HOST is unset or empty', async () => {
    const { file } = await tokenFile('tok');
    const { AGENTDESK_GIT_HOST: _unused, ...unset } = baseEnv(file);
    expect(await run(helper, ['get'], unset, ask)).toEqual({ stdout: '', stderr: '', code: 0 });
    expect(await run(helper, ['get'], { ...unset, AGENTDESK_GIT_HOST: '' }, ask)).toEqual({
      stdout: '',
      stderr: '',
      code: 0,
    });
  });

  it('fails without printing a token when the file is missing or empty', async () => {
    const missing = await run(helper, ['get'], baseEnv('/nonexistent/token'), ask);
    expect(missing.code).not.toBe(0);
    expect(missing.stdout).toBe('');
    const { file } = await tokenFile('\n');
    const empty = await run(helper, ['get'], baseEnv(file), ask);
    expect(empty.code).not.toBe(0);
    expect(empty.stdout).toBe('');
  });
});

describe('gh wrapper', () => {
  async function fakeGh(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'real-gh-'));
    const gh = join(dir, 'gh');
    await writeFile(
      gh,
      '#!/bin/sh\nprintf "token=%s custom=%s args=%s\\n" "${GH_TOKEN-unset}" "${MY_CLI_TOKEN-unset}" "$*"\n',
    );
    await chmod(gh, 0o755);
    return dir;
  }
  const wrapperEnv = (realDir: string, extra: Record<string, string>) => ({
    PATH: `${ghWrapperDir}:${realDir}:/usr/bin:/bin`,
    ...extra,
  });

  it('exports the variable named by AGENTDESK_CLI_TOKEN_ENV from the file on each call and passes the arguments through', async () => {
    const realDir = await fakeGh();
    const { file } = await tokenFile('tok-one\n');
    const env = wrapperEnv(realDir, { AGENTDESK_TOKEN_FILE: file, AGENTDESK_CLI_TOKEN_ENV: 'GH_TOKEN' });
    expect((await run('gh', ['pr', 'list'], env)).stdout).toBe('token=tok-one custom=unset args=pr list\n');
    await writeFile(file, 'tok-two');
    expect((await run('gh', ['pr', 'list'], env)).stdout).toBe('token=tok-two custom=unset args=pr list\n');
  });

  it('exports a custom variable name when the adapter names one', async () => {
    const realDir = await fakeGh();
    const { file } = await tokenFile('tok-x');
    const env = wrapperEnv(realDir, { AGENTDESK_TOKEN_FILE: file, AGENTDESK_CLI_TOKEN_ENV: 'MY_CLI_TOKEN' });
    expect((await run('gh', ['x'], env)).stdout).toBe('token=unset custom=tok-x args=x\n');
  });

  it('refuses an invalid variable name without running gh or printing the token', async () => {
    const realDir = await fakeGh();
    const { file } = await tokenFile('tok-x');
    for (const bad of ['1BAD', 'A-B', 'A B', 'A=B', 'A;id', '']) {
      const env = wrapperEnv(realDir, { AGENTDESK_TOKEN_FILE: file, AGENTDESK_CLI_TOKEN_ENV: bad });
      const r = await run('gh', ['x'], env);
      if (bad === '') {
        // Unset-equivalent: behaves as if no token file were configured.
        expect(r.stdout).toBe('token=unset custom=unset args=x\n');
      } else {
        expect(r.code).not.toBe(0);
        expect(r.stdout).toBe('');
        expect(r.stderr).not.toContain('tok-x');
      }
    }
  });

  it('does not export anything when AGENTDESK_CLI_TOKEN_ENV is unset', async () => {
    const realDir = await fakeGh();
    const { file } = await tokenFile('tok-x');
    const r = await run('gh', ['x'], wrapperEnv(realDir, { AGENTDESK_TOKEN_FILE: file }));
    expect(r.stdout).toBe('token=unset custom=unset args=x\n');
  });

  it('leaves GH_TOKEN alone when no token file is configured', async () => {
    const realDir = await fakeGh();
    const r = await run('gh', ['--version'], wrapperEnv(realDir, { GH_TOKEN: 'from-env' }));
    expect(r.stdout).toBe('token=from-env custom=unset args=--version\n');
  });

  it('fails clearly, without looping, when there is no real gh', async () => {
    const r = await run('gh', ['--version'], { PATH: `${ghWrapperDir}:/usr/bin:/bin` });
    expect(r.code).toBe(127);
    expect(r.stderr).toContain('gh: not found');
  });
});

describe('entrypoint token file', () => {
  it('registers the credential helper before cloning when AGENTDESK_TOKEN_FILE is set', async () => {
    const r = await runEntrypoint({ AGENTDESK_TOKEN_FILE: '/var/run/agentdesk/workspace-token/token' }, {});
    const git = r.calls.filter((c) => c.cmd === 'git').map((c) => c.argv);
    const configIdx = git.findIndex((a) => a[0] === 'config' && a.includes('credential.helper'));
    const cloneIdx = git.findIndex((a) => a[0] === 'clone');
    expect(configIdx).toBeGreaterThan(-1);
    expect(git[configIdx]).toEqual(['config', '--global', 'credential.helper', helper]);
    expect(configIdx).toBeLessThan(cloneIdx);
  });

  it('does not touch credential config without a token file (env-token runs are unchanged)', async () => {
    const r = await runEntrypoint({}, {});
    const git = r.calls.filter((c) => c.cmd === 'git').map((c) => c.argv);
    expect(git.some((a) => a.includes('credential.helper'))).toBe(false);
  });
});
