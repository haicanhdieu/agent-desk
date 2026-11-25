import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEntrypoint } from './harness.js';

const runnerDir = join(import.meta.dirname, '..');
const stubs = join(import.meta.dirname, 'stubs');
const GIT = { '.git/HEAD': 'ref: refs/heads/main' };
// About 10 KB, unicode and an escaped newline inside a string (Review Focus 1).
const AUTH_JSON = '{"tokens":{"a":"ünï\\ncode ✓"},"pad":"' + 'x'.repeat(10_000) + '"}\n\n';
const API_KEY = 'sk-test-KEY-0123456789-abcdef';

const newHome = () => mkdtempSync(join(tmpdir(), 'codex-home-'));
const baseEnv = (home: string) => ({
  AGENT: 'codex',
  HOME: home,
  AGENTDESK_REPO_DIR: join(home, 'repo'),
  STUB_EXPECT_KEY: API_KEY,
});
const sessionCmd = (r: Awaited<ReturnType<typeof runEntrypoint>>) => {
  const call = r.calls.find((c) => c.cmd === 'tmux' && c.argv.includes('new-session'));
  return call?.argv.at(-1) ?? '';
};

describe('codex entrypoint', () => {
  it('prints the launch line with the model and no endpoint', async () => {
    const home = newHome();
    const r = await runEntrypoint({ ...baseEnv(home), AGENT_MODEL: 'gpt-6-sol' }, {});
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('agentdesk: agent codex model gpt-6-sol endpoint default');
  });

  it('starts the TUI from the fixed command file with the model only as an env value', async () => {
    const home = newHome();
    const hostile = '$(touch PWNED); `touch PWNED2` "x" -rm';
    const r = await runEntrypoint({ ...baseEnv(home), AGENT_MODEL: hostile }, {});
    const cmd = sessionCmd(r);
    expect(cmd).toContain('exec codex');
    expect(cmd).toContain('$AGENT_MODEL');
    expect(cmd).not.toContain('PWNED');
    // Run the exact command the way tmux's shell does: the model arrives as one argv element and nothing is evaluated.
    const work = mkdtempSync(join(tmpdir(), 'codex-run-'));
    const log = join(work, 'stub.log');
    writeFileSync(log, '');
    const run = spawnSync('bash', ['-c', cmd], {
      cwd: work,
      encoding: 'utf8',
      env: {
        PATH: `${stubs}:${process.env.PATH}`,
        HOME: work,
        STUB_LOG: log,
        AGENT_MODEL: hostile,
        PROMPT: '-- do it; rm -rf /',
      },
    });
    expect(run.status).toBe(0);
    expect(existsSync(join(work, 'PWNED'))).toBe(false);
    expect(existsSync(join(work, 'PWNED2'))).toBe(false);
    const argv = (JSON.parse(readFileSync(log, 'utf8').trim()) as { argv: string[] }).argv;
    expect(argv).toContain(`--model=${hostile}`);
    expect(argv.at(-1)).toBe('-- do it; rm -rf /');
    expect(argv.at(-2)).toBe('--');
    expect(argv).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(argv).not.toContain('--dangerously-bypass-hook-trust');
    expect(argv).toContain('cli_auth_credentials_store="file"');
    expect(argv.some((a) => a.startsWith('projects."') && a.endsWith('.trust_level="trusted"'))).toBe(true);
  });

  it('starts with no --model when the run has none', async () => {
    const home = newHome();
    const r = await runEntrypoint(baseEnv(home), {});
    const work = mkdtempSync(join(tmpdir(), 'codex-run-'));
    const log = join(work, 'stub.log');
    writeFileSync(log, '');
    spawnSync('bash', ['-c', sessionCmd(r)], {
      encoding: 'utf8',
      env: { PATH: `${stubs}:${process.env.PATH}`, HOME: work, STUB_LOG: log, PROMPT: 'p' },
    });
    expect(readFileSync(log, 'utf8')).not.toContain('--model');
  });

  it('resumes with the spike resume command (codex resume --last) and the resume note as the prompt', async () => {
    const home = newHome();
    const env = { ...baseEnv(home), AGENT_MODEL: 'gpt-6-sol' };
    await runEntrypoint(env, GIT);
    const r = await runEntrypoint({ ...env, RUN_MODE: 'resume' }, {});
    const cmd = sessionCmd(r);
    expect(cmd).toMatch(/^exec codex resume --last /);
    const work = mkdtempSync(join(tmpdir(), 'codex-run-'));
    const log = join(work, 'stub.log');
    writeFileSync(log, '');
    spawnSync('bash', ['-c', cmd], {
      encoding: 'utf8',
      env: {
        PATH: `${stubs}:${process.env.PATH}`,
        HOME: work,
        STUB_LOG: log,
        AGENT_MODEL: 'gpt-6-sol',
        RESUME_NOTE: 'carry on',
      },
    });
    const argv = (JSON.parse(readFileSync(log, 'utf8').trim()) as { argv: string[] }).argv;
    expect(argv.slice(0, 2)).toEqual(['resume', '--last']);
    expect(argv).toContain('--model=gpt-6-sol');
    expect(argv.at(-1)).toBe('carry on');
  });

  describe('auth_json credential file (shared rule with OpenCode)', () => {
    it('writes auth.json byte for byte, mode 0600, and never echoes it', async () => {
      const home = newHome();
      const r = await runEntrypoint({ ...baseEnv(home), AGENT_CREDENTIAL_FILE: AUTH_JSON }, {});
      expect(r.exitCode).toBe(0);
      const file = join(home, '.codex', 'auth.json');
      expect(readFileSync(file, 'utf8')).toBe(AUTH_JSON);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const everything = JSON.stringify(r);
      for (const leak of ['tokens', 'ünï', 'xxxxxxxxxx']) expect(everything).not.toContain(leak);
      expect(r.calls.some((c) => c.cmd === 'codex')).toBe(false);
    });

    it.each([
      ['a resume with the same version does not rewrite it', 'v1', 'v1', false],
      ['a resume with a changed version rewrites it', 'v1', 'v2', true],
    ])('%s', async (_name, first, second, rewritten) => {
      const home = newHome();
      const env = { ...baseEnv(home), AGENT_CREDENTIAL_FILE: AUTH_JSON };
      await runEntrypoint({ ...env, AGENT_CREDENTIAL_VERSION: first }, GIT);
      const file = join(home, '.codex', 'auth.json');
      // The CLI refreshed the token on the volume.
      writeFileSync(file, '{"refreshed":true}');
      const r = await runEntrypoint({ ...env, RUN_MODE: 'resume', AGENT_CREDENTIAL_VERSION: second }, {});
      expect(r.exitCode).toBe(0);
      expect(readFileSync(file, 'utf8')).toBe(rewritten ? AUTH_JSON : '{"refreshed":true}');
    });

    it('writes nothing when there is no credential', async () => {
      const home = newHome();
      const r = await runEntrypoint(baseEnv(home), {});
      expect(existsSync(join(home, '.codex', 'auth.json'))).toBe(false);
      expect(r.calls.some((c) => c.cmd === 'codex')).toBe(false);
    });
  });

  describe('API key', () => {
    it('is stored for the TUI through `codex login --with-api-key` on stdin, not argv and never in the log', async () => {
      const home = newHome();
      const r = await runEntrypoint({ ...baseEnv(home), CODEX_API_KEY: API_KEY }, {});
      expect(r.exitCode).toBe(0);
      const logins = r.calls.filter((c) => c.cmd === 'codex');
      expect(logins).toHaveLength(1);
      expect(logins[0]).toMatchObject({
        argv: ['-c', 'cli_auth_credentials_store="file"', 'login', '--with-api-key'],
        stdinIsExpectedKey: true,
      });
      expect(JSON.stringify(r)).not.toContain(API_KEY);
      expect(existsSync(join(home, '.codex', 'auth.json'))).toBe(false); // written by the CLI, not the entrypoint
    });

    it('a failed login ends the pod with the distinct code and the fixed reason, without the CLI output or the key', async () => {
      const home = newHome();
      const r = await runEntrypoint({ ...baseEnv(home), CODEX_API_KEY: API_KEY, STUB_CODEX_LOGIN_FAIL: '1' }, {});
      expect(r.exitCode).toBe(77);
      expect(r.stdout).toContain('agentdesk: the agent credential could not be imported');
      expect(JSON.stringify(r)).not.toContain(API_KEY);
      expect(r.stdout.join('\n')).not.toContain('login failed');
      expect(r.calls.some((c) => c.cmd === 'tmux' && c.argv.includes('new-session'))).toBe(false);
    });
  });

  it('ships a managed hook config (requirements.toml) and does not bypass hook trust', () => {
    const toml = readFileSync(join(runnerDir, 'agents', 'codex', 'managed-config.toml'), 'utf8');
    for (const event of [
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'Stop',
    ]) {
      expect(toml).toContain(`[[hooks.${event}]]`);
    }
    expect(toml).toContain('node /usr/local/lib/agentdesk/agents/codex/hook.mjs');
    expect(toml).toContain('managed_dir = "/usr/local/lib/agentdesk/agents/codex"');
    expect(readFileSync(join(runnerDir, 'agents', 'codex', 'commands.sh'), 'utf8')).not.toContain('hook-trust');
  });
});
