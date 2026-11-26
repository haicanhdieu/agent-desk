import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEntrypoint } from './harness.js';

const runnerDir = join(import.meta.dirname, '..');
const stubs = join(import.meta.dirname, 'stubs');
const GIT = { '.git/HEAD': 'ref: refs/heads/main' };
// About 10 KB, unicode and an escaped newline inside a string.
const AUTH_JSON =
  '[{"id":"cred_new","integrationID":"openai","label":"x","active":true,"value":{"type":"oauth","refresh":"ünï\\ncode ✓"}}]\n' +
  ' '.repeat(10_000);
const API_KEY = 'sk-test-KEY-0123456789-abcdef';
const CONFIG = JSON.stringify({
  provider: {
    agentdesk: {
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: 'https://llm.example.invalid:8443/v1' },
      env: ['AGENTDESK_LLM_API_KEY'],
      models: { '$(touch PWNED)': {} },
    },
  },
});

const newHome = () => mkdtempSync(join(tmpdir(), 'opencode-home-'));
const baseEnv = (home: string) => ({
  AGENT: 'opencode',
  HOME: home,
  AGENTDESK_REPO_DIR: join(home, 'repo'),
  AGENTDESK_RUN_DIR: join(home, 'run'),
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  STUB_EXPECT_AUTH: AUTH_JSON,
});
type Result = Awaited<ReturnType<typeof runEntrypoint>>;
type Call = Result['calls'][number] & Record<string, unknown>;
const sessionCmd = (r: Result) =>
  r.calls.find((c) => c.cmd === 'tmux' && c.argv.includes('new-session'))?.argv.at(-1) ?? '';
// The transcript flush (`opencode session ...`) runs at every start and end; these are the calls the run itself makes.
const opencodeCalls = (r: Result) => r.calls.filter((c) => c.cmd === 'opencode' && c.argv[0] !== 'session') as Call[];
const imports = (r: Result) => opencodeCalls(r).filter((c) => c.argv[0] === 'auth' && c.argv[1] === 'import');

/** Runs the fixed session command the way tmux's shell does, with the stub CLI on PATH; returns the stub log. */
const runSession = (cmd: string, env: Record<string, string>): Call[] => {
  const work = mkdtempSync(join(tmpdir(), 'opencode-run-'));
  const log = join(work, 'stub.log');
  writeFileSync(log, '');
  const r = spawnSync('bash', ['-c', cmd], {
    cwd: work,
    encoding: 'utf8',
    env: { PATH: `${stubs}:${process.env.PATH}`, HOME: work, STUB_LOG: log, PROMPT: 'p', ...env },
  });
  expect(r.status).toBe(0);
  expect(existsSync(join(work, 'PWNED'))).toBe(false);
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Call);
};

describe('opencode entrypoint', () => {
  it('accepts AGENT=opencode and prints the launch line first, with no endpoint', async () => {
    const home = newHome();
    const r = await runEntrypoint({ ...baseEnv(home), AGENT_MODEL: 'opencode/big-pickle' }, {});
    expect(r.exitCode).toBe(0);
    expect(r.stdout[0]).toBe('agentdesk: agent opencode model opencode/big-pickle endpoint default');
  });

  it('installs the status plugin where OpenCode auto-loads it, from the fixed file', async () => {
    const home = newHome();
    await runEntrypoint(baseEnv(home), {});
    const file = join(home, '.config', 'opencode', 'plugins', 'agentdesk-status.js');
    expect(readFileSync(file, 'utf8')).toBe(readFileSync(join(runnerDir, 'agents', 'opencode', 'hook.mjs'), 'utf8'));
    const xdg = join(home, 'xdg');
    await runEntrypoint({ ...baseEnv(home), XDG_CONFIG_HOME: xdg }, {});
    expect(existsSync(join(xdg, 'opencode', 'plugins', 'agentdesk-status.js'))).toBe(true);
  });

  describe('model selection (the TUI has no --model flag; a user config file preselects it)', () => {
    const configFile = (home: string) => join(home, '.config', 'opencode', 'opencode.json');

    it('writes the model as JSON into the user config file, hostile text included, and never runs it', async () => {
      const home = newHome();
      const hostile = 'agentdesk/org/$(touch PWNED); `touch PWNED2` "x"';
      const r = await runEntrypoint({ ...baseEnv(home), AGENT_MODEL: hostile }, {});
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(configFile(home), 'utf8'))).toEqual({ model: hostile });
      expect(existsSync(join(home, 'PWNED'))).toBe(false);
      expect(existsSync(join(home, 'PWNED2'))).toBe(false);
    });

    it('writes no config file without a model, and removes the one an earlier start with a model wrote', async () => {
      const home = newHome();
      await runEntrypoint(baseEnv(home), {});
      expect(existsSync(configFile(home))).toBe(false);
      await runEntrypoint({ ...baseEnv(home), AGENT_MODEL: 'opencode/big-pickle' }, {});
      expect(existsSync(configFile(home))).toBe(true);
      await runEntrypoint(baseEnv(home), {});
      expect(existsSync(configFile(home))).toBe(false);
    });

    it('honours XDG_CONFIG_HOME', async () => {
      const home = newHome();
      const xdg = join(home, 'xdg');
      await runEntrypoint({ ...baseEnv(home), XDG_CONFIG_HOME: xdg, AGENT_MODEL: 'openai/gpt-x' }, {});
      expect(JSON.parse(readFileSync(join(xdg, 'opencode', 'opencode.json'), 'utf8'))).toEqual({
        model: 'openai/gpt-x',
      });
    });
  });

  describe('start and resume commands', () => {
    it('starts the TUI after `service set disabled true` (once); the prompt is one argv element and the TUI gets no --model (it has no such flag)', async () => {
      const home = newHome();
      const hostile = '$(touch PWNED); `touch PWNED2` "x" -rm';
      const r = await runEntrypoint({ ...baseEnv(home), AGENT_MODEL: hostile }, {});
      const cmd = sessionCmd(r);
      expect(cmd).not.toContain('$AGENT_MODEL');
      expect(cmd).not.toContain('PWNED');
      const calls = runSession(cmd, { AGENT_MODEL: hostile, PROMPT: '-- do it; rm -rf /' });
      expect(calls.map((c) => c.argv.slice(0, 3))).toEqual([['service', 'set', 'disabled'], expect.anything()]);
      expect(calls[0]!.argv).toEqual(['service', 'set', 'disabled', 'true']);
      expect(calls.filter((c) => c.argv[0] === 'service')).toHaveLength(1);
      expect(calls[1]!.argv).toEqual(['--prompt=-- do it; rm -rf /']);
    });

    it('starts with no flag at all when the run has no prompt', async () => {
      const r = await runEntrypoint(baseEnv(newHome()), {});
      const calls = runSession(sessionCmd(r), { PROMPT: '' });
      expect(calls.at(-1)!.argv).toEqual([]);
    });

    it('resumes with the spike resume command (--continue) and the resume note as the prompt', async () => {
      const home = newHome();
      const env = { ...baseEnv(home), AGENT_MODEL: 'opencode/big-pickle' };
      await runEntrypoint(env, GIT);
      const r = await runEntrypoint({ ...env, RUN_MODE: 'resume' }, {});
      const calls = runSession(sessionCmd(r), { AGENT_MODEL: 'opencode/big-pickle', RESUME_NOTE: 'carry on' });
      const tui = calls.at(-1)!;
      expect(tui.argv).toEqual(['--continue', '--prompt=carry on']);
    });
  });

  describe('no credential', () => {
    it('calls no import, writes no credential file and the stub sees no key variable', async () => {
      const home = newHome();
      const r = await runEntrypoint(baseEnv(home), {});
      expect(r.exitCode).toBe(0);
      expect(opencodeCalls(r)).toEqual([]);
      const runDir = join(home, 'run');
      expect(existsSync(runDir) ? readdirSync(runDir).filter((n) => n.includes('auth')) : []).toEqual([]);
      const calls = runSession(sessionCmd(r), {});
      expect(calls.every((c) => c.hasKeyEnv === false && c.hasConfigEnv === false)).toBe(true);
    });
  });

  describe('credentials file (auth_json)', () => {
    it('imports once through argv from a 0600 file under the run dir, deletes it, and never echoes it', async () => {
      const home = newHome();
      const r = await runEntrypoint(
        { ...baseEnv(home), AGENT_CREDENTIAL_FILE: AUTH_JSON, AGENT_CREDENTIAL_VERSION: 'v1' },
        {},
      );
      expect(r.exitCode).toBe(0);
      const [call] = imports(r);
      expect(imports(r)).toHaveLength(1);
      expect(call!.argv.slice(0, 2)).toEqual(['auth', 'import']);
      const file = call!.argv.at(-1)!;
      expect(file.startsWith(join(home, 'run') + '/')).toBe(true);
      expect(call).toMatchObject({ fileMode: 0o600, fileIsExpected: true });
      expect(existsSync(file)).toBe(false);
      const everything = JSON.stringify(r);
      for (const leak of ['cred_new', 'ünï', 'refresh']) expect(everything).not.toContain(leak);
      expect(readFileSync(join(home, '.agentdesk', 'credential-version'), 'utf8')).toBe('v1');
    });

    it('a failed import ends the pod with the distinct code and the fixed reason, deletes the file, shows no CLI output', async () => {
      const home = newHome();
      const r = await runEntrypoint(
        { ...baseEnv(home), AGENT_CREDENTIAL_FILE: AUTH_JSON, STUB_OPENCODE_IMPORT_FAIL: '1' },
        {},
      );
      expect(r.exitCode).toBe(77);
      expect(r.stdout).toContain('agentdesk: the agent credential could not be imported');
      expect(JSON.stringify(r)).not.toContain('import failed');
      expect(JSON.stringify(r)).not.toContain('cred_new');
      expect(r.calls.some((c) => c.cmd === 'tmux' && c.argv.includes('new-session'))).toBe(false);
      const [call] = imports(r);
      expect(existsSync(call!.argv.at(-1)!)).toBe(false);
    });

    it('a resume with the same version does not import again', async () => {
      const home = newHome();
      const env = { ...baseEnv(home), AGENT_CREDENTIAL_FILE: AUTH_JSON, AGENT_CREDENTIAL_VERSION: 'v1' };
      await runEntrypoint(env, GIT);
      const r = await runEntrypoint({ ...env, RUN_MODE: 'resume' }, {});
      expect(r.exitCode).toBe(0);
      expect(opencodeCalls(r)).toEqual([]);
    });

    it('a resume with a changed version logs out every stored credential of the same integration, then imports', async () => {
      const home = newHome();
      const env = { ...baseEnv(home), AGENT_CREDENTIAL_FILE: AUTH_JSON };
      await runEntrypoint({ ...env, AGENT_CREDENTIAL_VERSION: 'v1' }, GIT);
      const stored = JSON.stringify([
        { id: 'cred_old', integrationID: 'openai', active: true, value: { type: 'oauth' } },
        { id: 'cred_older', integrationID: 'openai', active: false, value: { type: 'key', key: 'k' } },
        { id: 'cred_other', integrationID: 'anthropic', active: true, value: { type: 'key', key: 'k' } },
        { id: '--evil', integrationID: 'openai', active: false, value: {} },
      ]);
      const r = await runEntrypoint(
        { ...env, RUN_MODE: 'resume', AGENT_CREDENTIAL_VERSION: 'v2', STUB_OPENCODE_EXPORT: stored },
        {},
      );
      expect(r.exitCode).toBe(0);
      const verbs = opencodeCalls(r).map((c) => c.argv.filter((a) => a !== '--standalone').join(' '));
      expect(verbs.slice(0, 4)).toEqual([
        'auth export',
        'auth logout openai cred_old',
        'auth logout openai cred_older',
        expect.stringMatching(/^auth import /),
      ]);
      expect(verbs).toHaveLength(4);
      expect(imports(r)).toHaveLength(1);
      expect(readFileSync(join(home, '.agentdesk', 'credential-version'), 'utf8')).toBe('v2');
    });

    it('a first start has nothing to log out', async () => {
      const r = await runEntrypoint({ ...baseEnv(newHome()), AGENT_CREDENTIAL_FILE: AUTH_JSON }, {});
      expect(opencodeCalls(r).map((c) => c.argv[1])).toEqual(['import']);
    });
  });

  describe('own endpoint and key', () => {
    const env = (home: string) => ({
      ...baseEnv(home),
      AGENTDESK_LLM_API_KEY: API_KEY,
      OPENCODE_CONFIG_CONTENT: CONFIG,
      AGENT_MODEL: 'agentdesk/$(touch PWNED)',
    });

    it('prints the endpoint origin in the launch line and calls no import', async () => {
      const r = await runEntrypoint(env(newHome()), {});
      expect(r.exitCode).toBe(0);
      expect(r.stdout[0]).toBe(
        'agentdesk: agent opencode model ??touch?PWNED? endpoint https://llm.example.invalid:8443',
      );
      expect(imports(r)).toEqual([]);
    });

    it('with no model prints model default and still starts the agent (unset AGENT_MODEL)', async () => {
      const { AGENT_MODEL: _unset, ...rest } = env(newHome());
      const r = await runEntrypoint(rest, {});
      expect(r.exitCode).toBe(0);
      expect(r.stdout[0]).toBe('agentdesk: agent opencode model default endpoint https://llm.example.invalid:8443');
    });

    it('strips the agentdesk/ prefix from a plain model in the launch line', async () => {
      const r = await runEntrypoint({ ...env(newHome()), AGENT_MODEL: 'agentdesk/x' }, {});
      expect(r.exitCode).toBe(0);
      expect(r.stdout[0]).toBe('agentdesk: agent opencode model x endpoint https://llm.example.invalid:8443');
    });

    it('hands the key and the inline config to the CLI; hostile values reach no shell; the key is in no line', async () => {
      const home = newHome();
      const r = await runEntrypoint(env(home), {});
      expect(JSON.stringify(r)).not.toContain(API_KEY);
      expect(existsSync(join(home, 'PWNED'))).toBe(false);
      const calls = runSession(sessionCmd(r), {
        AGENT_MODEL: 'agentdesk/$(touch PWNED)',
        AGENTDESK_LLM_API_KEY: API_KEY,
        OPENCODE_CONFIG_CONTENT: CONFIG,
        OPENCODE_DISABLE_AUTOUPDATE: '1',
      });
      const tui = calls.at(-1)!;
      expect(tui).toMatchObject({ hasKeyEnv: true, hasConfigEnv: true, autoupdateOff: true });
      expect(JSON.stringify(tui.argv)).not.toContain('PWNED');
    });

    it('a config that is not JSON or has an odd address prints the endpoint as default', async () => {
      for (const bad of [
        'not json',
        JSON.stringify({ provider: { agentdesk: { options: { baseURL: 'https://u:p@h.example/v1' } } } }),
        '{}',
      ]) {
        const r = await runEntrypoint({ ...env(newHome()), OPENCODE_CONFIG_CONTENT: bad }, {});
        expect(r.exitCode).toBe(0);
        expect(r.stdout[0]).toMatch(/ endpoint default$/);
      }
    });
  });

  it('ships a managed config the image installs under /etc/opencode, and the plugin source', () => {
    const managed = JSON.parse(
      readFileSync(join(runnerDir, 'agents', 'opencode', 'managed-config.json'), 'utf8'),
    ) as Record<string, unknown>;
    // `update` and `share` are the real config keys of CLI 2.4.1 (`autoupdate` is a dropped legacy name).
    expect(managed).toMatchObject({ update: 'disable', share: 'disabled' });
    expect(managed).not.toHaveProperty('autoupdate');
    const docker = readFileSync(join(runnerDir, 'Dockerfile'), 'utf8');
    expect(docker).toContain('COPY agents/opencode/managed-config.json /etc/opencode/opencode.json');
    expect(docker).toContain('/etc/opencode/opencode.json');
  });
});
