import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEntrypoint } from './harness.js';

const START_CMD = 'exec claude --permission-mode bypassPermissions ${AGENT_MODEL:+--model "$AGENT_MODEL"} "$PROMPT"';
const RESUME_CMD = 'exec claude --permission-mode bypassPermissions ${AGENT_MODEL:+--model "$AGENT_MODEL"} --continue';

type Result = Awaited<ReturnType<typeof runEntrypoint>>;

const runnerHooks = join(import.meta.dirname, '..', 'hooks');

const OFFICIAL = 'anthropics/claude-plugins-official';
const market = JSON.stringify({ 'claude-plugins-official': OFFICIAL });
const settings = (enabled: Record<string, boolean>) => ({
  '.claude/settings.json': JSON.stringify({ enabledPlugins: enabled }),
});
const claudeCalls = (r: Result) => r.calls.filter((c) => c.cmd === 'claude').map((c) => c.argv);
const started = (r: Result) =>
  r.stdout.includes('agentdesk: session started') &&
  r.calls.some((c) => c.cmd === 'tmux' && c.argv.includes('new-session'));

describe('entrypoint plugins phase', () => {
  it('installs approved plugins with one argv element per value', async () => {
    const r = await runEntrypoint(
      { PLUGIN_MARKETPLACES: market },
      settings({ 'superpowers@claude-plugins-official': true, 'tdd@claude-plugins-official': true }),
    );
    expect(claudeCalls(r)).toEqual([
      ['plugin', 'marketplace', 'add', OFFICIAL],
      ['plugin', 'install', 'superpowers@claude-plugins-official'],
      ['plugin', 'install', 'tdd@claude-plugins-official'],
    ]);
    expect(
      r.calls
        .filter((c) => c.cmd === 'timeout' && c.argv[1] !== 'tmux' && !c.argv[2]?.endsWith('transcript.mjs'))
        .map((c) => c.argv[0]),
    ).toEqual(['120', '120', '120']);
    expect(r.stdout).toContain('agentdesk: plugin installed superpowers@claude-plugins-official');
    expect(r.stdout.indexOf('agentdesk: plugins begin')).toBeGreaterThan(-1);
    expect(r.stdout.indexOf('agentdesk: plugins begin')).toBeLessThan(r.stdout.indexOf('agentdesk: plugins end'));
    expect(r.stdout.indexOf('agentdesk: plugins end')).toBeLessThan(r.stdout.indexOf('agentdesk: session started'));
    expect(r.exitCode).toBe(0);
  });

  it('installs from a built-in store without registering a marketplace', async () => {
    const r = await runEntrypoint(
      { PLUGIN_MARKETPLACES: JSON.stringify({ 'anthropic-plugin-directory': 'builtin' }) },
      settings({ 'superpowers@anthropic-plugin-directory': true, 'playwright@anthropic-plugin-directory': true }),
    );
    expect(claudeCalls(r)).toEqual([
      ['plugin', 'install', 'playwright@anthropic-plugin-directory'],
      ['plugin', 'install', 'superpowers@anthropic-plugin-directory'],
    ]);
    expect(r.stdout).toContain('agentdesk: plugin installed superpowers@anthropic-plugin-directory');
    expect(started(r)).toBe(true);
  });

  it('skips unapproved store', async () => {
    const r = await runEntrypoint({ PLUGIN_MARKETPLACES: market }, settings({ 'evil@rogue-store': true }));
    expect(r.stdout).toContain('agentdesk: plugin skipped evil@rogue-store (store not approved)');
    expect(claudeCalls(r)).toEqual([]);
    expect(started(r)).toBe(true);
  });

  it('plugin failure warns and continues', async () => {
    const r = await runEntrypoint(
      { PLUGIN_MARKETPLACES: market, STUB_FAIL_PLUGIN: 'broken' },
      settings({ 'broken@claude-plugins-official': true, 'good@claude-plugins-official': true }),
    );
    expect(r.stdout).toContain('agentdesk: plugin failed broken@claude-plugins-official');
    expect(r.stdout).toContain('agentdesk: plugin installed good@claude-plugins-official');
    expect(started(r)).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it('a failing marketplace add fails its plugins and continues', async () => {
    const r = await runEntrypoint(
      { PLUGIN_MARKETPLACES: market, STUB_FAIL_PLUGIN: OFFICIAL },
      settings({ 'a@claude-plugins-official': true }),
    );
    expect(r.stdout).toContain('agentdesk: plugin failed a@claude-plugins-official');
    expect(claudeCalls(r)).toEqual([['plugin', 'marketplace', 'add', OFFICIAL]]);
    expect(started(r)).toBe(true);
  });

  describe('bad settings still starts the agent', () => {
    it.each([
      ['invalid json', { '.claude/settings.json': '{nope' }],
      ['no settings file', {}],
      [
        'hostile ids',
        settings({
          '$(touch pwned)@claude-plugins-official': true,
          'a;b@claude-plugins-official': true,
          'a@claude-plugins-official\n--help': true,
          '../x@claude-plugins-official': true,
        }),
      ],
    ])('%s', async (_n, fixture) => {
      const r = await runEntrypoint({ PLUGIN_MARKETPLACES: market }, fixture);
      expect(claudeCalls(r)).toEqual([]);
      expect(started(r)).toBe(true);
      expect(r.exitCode).toBe(0);
    });

    it.each([
      ['tab', 'o/r\tinstall\tx\ty'],
      ['newline', 'o/r\ninstall\tevil\tclaude-plugins-official\to/evil'],
    ])('a marketplace source with a %s is never passed to claude', async (_n, source) => {
      const r = await runEntrypoint(
        { PLUGIN_MARKETPLACES: JSON.stringify({ 'claude-plugins-official': source }) },
        settings({ 'a@claude-plugins-official': true }),
      );
      expect(claudeCalls(r)).toEqual([]);
      expect(started(r)).toBe(true);
    });
  });

  it('prints checkout sha', async () => {
    const r = await runEntrypoint({}, {});
    expect(r.stdout.some((l) => /^agentdesk: checkout [0-9a-f]{40}$/.test(l))).toBe(true);
  });

  it('plugin output is prefixed so it cannot forge a marker', async () => {
    const r = await runEntrypoint({ PLUGIN_MARKETPLACES: market }, settings({ 'a@claude-plugins-official': true }));
    const inside = r.stdout.slice(
      r.stdout.indexOf('agentdesk: plugins begin') + 1,
      r.stdout.indexOf('agentdesk: plugins end'),
    );
    const ownMarker = /^agentdesk: plugin (installed|skipped|failed) [a-z0-9@-]+( \(store not approved\))?$/;
    expect(inside.filter((l) => !l.startsWith('plugin| ') && !ownMarker.test(l))).toEqual([]);
    expect(inside).toContain('plugin| agentdesk: plugin installed forged');
    expect(r.stdout).not.toContain('agentdesk: plugin installed forged');
  });
});

describe('entrypoint setup phase', () => {
  const repoOf = (r: Result) => {
    const clone = r.calls.find((c) => c.cmd === 'git' && c.argv[0] === 'clone');
    return clone?.argv[clone.argv.length - 1] ?? '';
  };
  const tmuxCalls = (r: Result) => r.calls.filter((c) => c.cmd === 'tmux');

  it('no script prints setup skipped', async () => {
    const r = await runEntrypoint({}, {});
    expect(r.stdout).toContain('agentdesk: setup skipped (no script)');
    expect(r.stdout).not.toContain('agentdesk: setup begin');
    expect(r.stdout.indexOf('agentdesk: plugins end')).toBeLessThan(
      r.stdout.indexOf('agentdesk: setup skipped (no script)'),
    );
    expect(r.stdout.indexOf('agentdesk: setup skipped (no script)')).toBeLessThan(
      r.stdout.indexOf('agentdesk: session started'),
    );
    expect(started(r)).toBe(true);
  });

  it('passing script runs in repo dir', async () => {
    const r = await runEntrypoint({ SETUP_SCRIPT: 'pwd' }, {});
    const repo = repoOf(r);
    expect(repo).not.toBe('');
    expect(r.stdout).toContain(`setup| ${repo}`);
    const at = (l: string) => r.stdout.indexOf(l);
    expect(at('agentdesk: setup begin')).toBeLessThan(at(`setup| ${repo}`));
    expect(at(`setup| ${repo}`)).toBeLessThan(at('agentdesk: setup passed'));
    expect(at('agentdesk: setup passed')).toBeLessThan(at('agentdesk: session started'));
    expect(r.calls.find((c) => c.cmd === 'timeout' && c.argv.includes('bash'))?.argv.at(-3)).toBe('600');
    expect(r.exitCode).toBe(0);
  });

  it('the last line without a newline is kept and CR is stripped', async () => {
    const r = await runEntrypoint({ SETUP_SCRIPT: "printf 'a\\r\\nb'" }, {});
    expect(r.stdout).toContain('setup| a');
    expect(r.stdout).toContain('setup| b');
    expect(r.stdout.some((l) => l.includes('\r'))).toBe(false);
  });

  it('failing script exits 78 without tmux', async () => {
    const r = await runEntrypoint({ SETUP_SCRIPT: 'echo oops >&2; exit 3' }, {});
    expect(r.exitCode).toBe(78);
    expect(r.stdout).toContain('setup| oops');
    expect(r.stdout).toContain('agentdesk: setup failed exit=3');
    expect(r.stdout).not.toContain('agentdesk: session started');
    expect(tmuxCalls(r)).toEqual([]);
  });

  it('timeout prints setup timed out', async () => {
    const r = await runEntrypoint({ SETUP_SCRIPT: 'sleep 5', SETUP_TIMEOUT_SECONDS: '1' }, {});
    expect(r.stdout).toContain('agentdesk: setup timed out');
    expect(r.stdout.some((l) => l.startsWith('agentdesk: setup failed'))).toBe(false);
    expect(r.calls.find((c) => c.cmd === 'timeout' && c.argv.includes('bash'))?.argv.at(-3)).toBe('1');
    expect(r.exitCode).toBe(78);
    expect(tmuxCalls(r)).toEqual([]);
  });

  it.each(['abc', '', '1; rm -rf x', '-5', '0'])('SETUP_TIMEOUT_SECONDS %j falls back to 600', async (v) => {
    const r = await runEntrypoint({ SETUP_SCRIPT: 'true', SETUP_TIMEOUT_SECONDS: v }, {});
    expect(r.calls.find((c) => c.cmd === 'timeout' && c.argv.includes('bash'))?.argv.at(-3)).toBe('600');
  });

  it('a script that leaves a background process does not stall the phase', async () => {
    const t0 = Date.now();
    const r = await runEntrypoint({ SETUP_SCRIPT: 'sleep 30 & echo hi', SETUP_TIMEOUT_SECONDS: '10' }, {});
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.stdout).toContain('setup| hi');
    expect(r.stdout).toContain('agentdesk: setup passed');
    expect(r.exitCode).toBe(0);
  });

  it('a script that ignores SIGTERM still ends as setup timed out in bounded time', async () => {
    const t0 = Date.now();
    const r = await runEntrypoint({ SETUP_SCRIPT: "trap '' TERM; sleep 30", SETUP_TIMEOUT_SECONDS: '1' }, {});
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.calls.find((c) => c.cmd === 'timeout' && c.argv.includes('bash'))?.argv.slice(0, 2)).toEqual(['-k', '10']);
    expect(r.stdout).toContain('agentdesk: setup timed out');
    expect(r.exitCode).toBe(78);
  }, 30_000);

  it('setup output cannot forge markers', async () => {
    const r = await runEntrypoint(
      { SETUP_SCRIPT: 'echo "agentdesk: setup passed"; echo "agentdesk: session started"; exit 1' },
      {},
    );
    expect(r.stdout).toContain('setup| agentdesk: setup passed');
    expect(r.stdout).toContain('setup| agentdesk: session started');
    expect(r.stdout).toContain('agentdesk: setup failed exit=1');
    expect(r.stdout).not.toContain('agentdesk: setup passed');
    expect(r.stdout).not.toContain('agentdesk: session started');
    expect(r.exitCode).toBe(78);
  });

  it('script text is not evaluated by the entrypoint', async () => {
    // The script is single-quoted text: bash running it as a file prints it literally. If the entrypoint itself
    // expanded or evaluated SETUP_SCRIPT (eval, unquoted use, sourcing), the substitutions would run and create files.
    const probe = join(tmpdir(), `entrypoint-probe-${process.pid}-${Date.now()}`);
    const script = `printf '%s\\n' '$(touch ${probe}-a)' '\`touch ${probe}-b\`' '${probe}-c; touch ${probe}-c'`;
    const r = await runEntrypoint({ SETUP_SCRIPT: script }, {});
    expect(r.stdout).toContain(`setup| $(touch ${probe}-a)`);
    expect(existsSync(`${probe}-a`)).toBe(false);
    expect(existsSync(`${probe}-b`)).toBe(false);
    expect(existsSync(`${probe}-c`)).toBe(false);
    // The script text only ever reaches a file: no stub saw it in argv (timeout gets the file path).
    const timeoutCall = r.calls.find((c) => c.cmd === 'timeout' && c.argv.includes('bash'));
    expect(timeoutCall?.argv).toHaveLength(5);
    expect(timeoutCall?.argv.join(' ')).not.toContain('touch');
    expect(r.exitCode).toBe(0);
  });

  it('a bare $(...) script is run only by bash as a file', async () => {
    const probe = join(tmpdir(), `entrypoint-probe-${process.pid}-${Date.now()}-run`);
    const r = await runEntrypoint({ SETUP_SCRIPT: `$(touch ${probe})` }, {});
    expect(existsSync(probe)).toBe(true); // executed once, by bash reading the file
    expect(r.calls.find((c) => c.cmd === 'timeout' && c.argv.includes('bash'))?.argv.join(' ')).not.toContain('touch');
  });

  it('SETUP_SCRIPT is not in the env tmux sees', async () => {
    const r = await runEntrypoint({ SETUP_SCRIPT: 'true' }, {});
    expect(tmuxCalls(r).length).toBeGreaterThan(0);
    for (const c of tmuxCalls(r)) expect(c.setupScript).toBeNull();
  });

  describe('RUN_MODE=setup_test', () => {
    it('starts bash -l after failure and never claude', async () => {
      const r = await runEntrypoint({ RUN_MODE: 'setup_test', SETUP_SCRIPT: 'exit 2' }, {});
      expect(r.stdout).toContain('agentdesk: setup failed exit=2');
      expect(r.stdout).toContain('agentdesk: session started');
      const create = tmuxCalls(r).find((c) => c.argv.includes('new-session'));
      expect(create?.argv.some((a) => a.includes('bash -l'))).toBe(true);
      expect(create?.argv.some((a) => a.includes('claude'))).toBe(false);
      expect(create?.argv).toContain(repoOf(r));
      expect(create?.setupScript).toBeNull();
      expect(claudeCalls(r)).toEqual([]);
      expect(r.exitCode).toBe(0);
    });

    it('starts bash -l after pass', async () => {
      const r = await runEntrypoint({ RUN_MODE: 'setup_test', SETUP_SCRIPT: 'true' }, {});
      expect(r.stdout).toContain('agentdesk: setup passed');
      expect(
        tmuxCalls(r)
          .find((c) => c.argv.includes('new-session'))
          ?.argv.some((a) => a.includes('bash -l')),
      ).toBe(true);
    });

    it('with no script is skipped and still opens a shell', async () => {
      const r = await runEntrypoint({ RUN_MODE: 'setup_test' }, {});
      expect(r.stdout).toContain('agentdesk: setup skipped (no script)');
      expect(started(r)).toBe(true);
    });
  });
});

describe('entrypoint home on the volume and resume mode', () => {
  const tmuxCalls = (r: Result) => r.calls.filter((c) => c.cmd === 'tmux');
  const newSession = (r: Result) => tmuxCalls(r).find((c) => c.argv.includes('new-session'));
  const mkHome = (files: Record<string, string> = {}) => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(home, p, '..'), { recursive: true });
      writeFileSync(join(home, p), c);
    }
    return home;
  };
  const skel = () => mkHome({ '.claude/settings.json': '{"skel":true}', '.claude/keep.txt': 'from-skel' });
  const resumable = () => {
    const home = mkHome({ '.agentdesk/session-started': '' });
    const repo = mkHome();
    mkdirSync(join(repo, '.git'));
    return { home, repo };
  };

  it('copies the skeleton into HOME and writes the session marker after the session starts', async () => {
    const home = mkHome();
    const r = await runEntrypoint({ HOME: home, AGENTDESK_HOME_SKEL: skel() }, {});
    expect(readFileSync(join(home, '.claude/settings.json'), 'utf8')).toBe('{"skel":true}');
    expect(existsSync(join(home, '.agentdesk/session-started'))).toBe(true);
    expect(started(r)).toBe(true);
  });

  it('creates HOME when it does not exist yet', async () => {
    const home = join(mkHome(), 'nested', 'home');
    await runEntrypoint({ HOME: home, AGENTDESK_HOME_SKEL: skel() }, {});
    expect(existsSync(join(home, '.claude/settings.json'))).toBe(true);
  });

  it('does not overwrite a file already in HOME with the skeleton copy', async () => {
    const home = mkHome({ '.claude/keep.txt': 'mine' });
    await runEntrypoint({ HOME: home, AGENTDESK_HOME_SKEL: skel() }, {});
    expect(readFileSync(join(home, '.claude/keep.txt'), 'utf8')).toBe('mine');
  });

  it('normal mode starts the agent with the prompt command', async () => {
    const r = await runEntrypoint({}, {});
    expect(newSession(r)?.argv.at(-1)).toBe(START_CMD);
  });

  describe('model and launch line', () => {
    const argvOf = (cmd: string, env: Record<string, string>): string[] => {
      const bin = mkdtempSync(join(tmpdir(), 'claude-stub-'));
      const stub = join(bin, 'claude');
      writeFileSync(stub, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', {
        mode: 0o755,
      });
      const out = execFileSync('bash', ['-c', cmd], {
        env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, ...env },
        encoding: 'utf8',
      });
      return JSON.parse(out) as string[];
    };

    it('start and resume pass --model as one argv element, also with [1m]', async () => {
      const env = { AGENT_MODEL: 'sonnet[1m]', PROMPT: 'hi there' };
      const fresh = await runEntrypoint(env, {});
      const startArgv = argvOf(newSession(fresh)?.argv.at(-1) ?? '', env);
      expect(startArgv).toEqual(['--permission-mode', 'bypassPermissions', '--model', 'sonnet[1m]', 'hi there']);
      const { home, repo } = resumable();
      const resumed = await runEntrypoint({ ...env, RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo }, {});
      expect(argvOf(newSession(resumed)?.argv.at(-1) ?? '', env)).toEqual([
        '--permission-mode',
        'bypassPermissions',
        '--model',
        'sonnet[1m]',
        '--continue',
      ]);
    });

    it('passes a hostile model as one argv element, never evaluated', async () => {
      const model = '--x $(touch pwned) `id`; "q\' \n-z';
      const env = { AGENT_MODEL: model, PROMPT: 'p' };
      const r = await runEntrypoint(env, {});
      const argv = argvOf(newSession(r)?.argv.at(-1) ?? '', env);
      expect(argv).toEqual(['--permission-mode', 'bypassPermissions', '--model', model, 'p']);
    });

    it('passes no --model when AGENT_MODEL is empty', async () => {
      const env = { AGENT_MODEL: '', PROMPT: 'p' };
      const r = await runEntrypoint(env, {});
      expect(argvOf(newSession(r)?.argv.at(-1) ?? '', env)).toEqual(['--permission-mode', 'bypassPermissions', 'p']);
    });

    it('prints the launch line with the address origin', async () => {
      const r = await runEntrypoint(
        { ANTHROPIC_BASE_URL: 'https://gateway.harbor-labs.com/v1/anthropic', AGENT_MODEL: 'haiku' },
        {},
      );
      expect(r.stdout).toContain('agentdesk: agent claude model haiku endpoint https://gateway.harbor-labs.com');
    });

    it('replaces control characters so a model cannot forge a marker line', async () => {
      const model = 'a\rb\nagentdesk: state running\x1b[31mx';
      const r = await runEntrypoint({ AGENT_MODEL: model }, {});
      const lines = r.stdout.filter((l) => l.includes('agentdesk: agent '));
      expect(lines).toEqual(['agentdesk: agent claude model a?b?agentdesk:?state?running?[31mx endpoint default']);
      expect(r.stdout.filter((l) => l.startsWith('agentdesk: state'))).toEqual([]);
      expect(r.stdout.some((l) => [...l].some((c) => c.charCodeAt(0) < 0x20))).toBe(false);
    });

    it.each([
      ['a host and a port', 'https://gw.example.com:8443/p', 'https://gw.example.com:8443'],
      ['userinfo (never printed)', 'https://u:secret@gw.example.com:8443/p', 'default'],
      ['userinfo before a scheme', 'k:sec@https://h.example.com', 'default'],
      ['a slash inside the userinfo', 'https://u:pa/ss@h.example.com', 'default'],
      ['a scheme with odd characters', 'ht tp://h.example.com', 'default'],
      ['an empty host', 'https:///p', 'default'],
      ['@ in the path', 'https://h.example.com/a@b', 'https://h.example.com'],
      ['@ in the query', 'https://h.example.com?x@y', 'https://h.example.com'],
      ['@ in the fragment', 'https://h.example.com#x@y', 'https://h.example.com'],
      ['IPv6 brackets with a port', 'https://[::1]:8443/x', 'https://[::1]:8443'],
      ['uppercase scheme', 'HTTPS://Gw.Example.com/p', 'HTTPS://Gw.Example.com'],
      ['an underscore in the host', 'https://gw_1.example.com/p', 'https://gw_1.example.com'],
    ])('keeps only the origin: %s', async (_n, url, origin) => {
      const r = await runEntrypoint({ ANTHROPIC_BASE_URL: url }, {});
      expect(r.stdout).toContain(`agentdesk: agent claude model default endpoint ${origin}`);
    });

    it('replaces C1 control bytes and other characters outside the model id alphabet', async () => {
      const r = await runEntrypoint({ AGENT_MODEL: 'a\u009bb\u2028c d' }, {});
      expect(r.stdout.filter((l) => l.includes('agentdesk: agent '))).toEqual([
        expect.stringMatching(/^agentdesk: agent claude model a\?+b\?+c\?d endpoint default$/),
      ]);
    });

    it.each(['sonnet[1m]', 'vendor/model', 'arn:aws:bedrock:us-east-1:1:model/x.y_z+1@2-3'])(
      'prints the model id %s unchanged',
      async (model) => {
        const r = await runEntrypoint({ AGENT_MODEL: model }, {});
        expect(r.stdout).toContain(`agentdesk: agent claude model ${model} endpoint default`);
      },
    );

    it('prints endpoint default for an address without ://', async () => {
      const r = await runEntrypoint({ ANTHROPIC_BASE_URL: 'gw.example.com/v1' }, {});
      expect(r.stdout).toContain('agentdesk: agent claude model default endpoint default');
    });

    it('prints no launch line in setup_test mode, where no agent starts', async () => {
      const r = await runEntrypoint({ RUN_MODE: 'setup_test', AGENT_MODEL: 'opus' }, {});
      expect(r.stdout.filter((l) => l.startsWith('agentdesk: agent '))).toEqual([]);
    });

    it('prints endpoint default and model default when unset', async () => {
      const r = await runEntrypoint({}, {});
      expect(r.stdout).toContain('agentdesk: agent claude model default endpoint default');
    });

    it('prints the launch line once, before the session starts, also on resume', async () => {
      const { home, repo } = resumable();
      const r = await runEntrypoint(
        { RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo, AGENT_MODEL: 'opus' },
        {},
      );
      const lines = r.stdout.filter((l) => l.startsWith('agentdesk: agent '));
      expect(lines).toEqual(['agentdesk: agent claude model opus endpoint default']);
      expect(r.stdout.indexOf(lines[0] ?? '')).toBeLessThan(r.stdout.indexOf('agentdesk: session started'));
    });

    it('a model value is printed with $() neutralised, never evaluated', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'pwn-'));
      const r = await runEntrypoint({ AGENT_MODEL: `$(touch ${join(dir, 'pwned')})` }, {});
      expect(existsSync(join(dir, 'pwned'))).toBe(false);
      expect(r.stdout.filter((l) => l.includes('agentdesk: agent '))).toEqual([
        expect.stringMatching(/^agentdesk: agent claude model \?\?touch\?\S*pwned\? endpoint default$/),
      ]);
    });

    it('never prints credentials from the address or the API key', async () => {
      const r = await runEntrypoint(
        { ANTHROPIC_BASE_URL: 'https://u:secret@gw.example.com:8443/p?k=secret', ANTHROPIC_API_KEY: 'sk-ant-xyz' },
        {},
      );
      const line = r.stdout.find((l) => l.startsWith('agentdesk: agent ')) ?? '';
      expect(line).toBe('agentdesk: agent claude model default endpoint default');
      expect(line).not.toContain('secret');
      expect(line).not.toContain('sk-ant-xyz');
    });
  });

  it('pre-approves the API key (last 20 chars) so Claude does not ask "use this API key?" on every new pod', async () => {
    const home = mkHome({});
    const key = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPOTa3I6nIDLQ0lxUYQAA';
    const r = await runEntrypoint({ HOME: home, ANTHROPIC_API_KEY: key }, {});
    const cfg = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')) as {
      customApiKeyResponses?: { approved: string[]; rejected: string[] };
    };
    expect(cfg.customApiKeyResponses).toEqual({ approved: [key.slice(-20)], rejected: [] });
    // Only the suffix Claude itself stores is written; the key never appears in the output.
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).not.toContain(key);
    expect(r.stdout.join('\n')).not.toContain(key);
  });

  it('writes no API key approval when the agent uses an OAuth token', async () => {
    const home = mkHome({});
    await runEntrypoint({ HOME: home, CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-value-0123456789' }, {});
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).not.toContain('customApiKeyResponses');
  });

  it('an unknown AGENT is rejected and never used as a path', async () => {
    const r = await runEntrypoint({ AGENT: '../../etc' }, {});
    expect(r.exitCode).not.toBe(0);
    expect(newSession(r)).toBeUndefined();
  });

  describe('RUN_MODE=resume', () => {
    it('continues the saved session without cloning, plugins or setup', async () => {
      const { home, repo } = resumable();
      const r = await runEntrypoint(
        { RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo, AGENTDESK_HOME_SKEL: skel() },
        {},
      );
      const at = (l: string) => r.stdout.indexOf(l);
      expect(at('agentdesk: session resumed')).toBeGreaterThan(-1);
      expect(at('agentdesk: session resumed')).toBeLessThan(at('agentdesk: session started'));
      expect(r.calls.some((c) => c.cmd === 'git' && c.argv[0] === 'clone')).toBe(false);
      const cmd = newSession(r)?.argv.at(-1);
      expect(cmd).toBe(RESUME_CMD);
      expect(cmd).not.toContain('PROMPT');
      expect(newSession(r)?.argv).toContain(repo);
      expect(r.stdout).not.toContain('agentdesk: plugins begin');
      expect(r.stdout).not.toContain('agentdesk: setup begin');
      expect(r.exitCode).toBe(0);
    });

    it('registers the git credential helper when a token file is set', async () => {
      const { home, repo } = resumable();
      const r = await runEntrypoint(
        { RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo, AGENTDESK_TOKEN_FILE: '/tmp/t' },
        {},
      );
      expect(
        r.calls.some((c) => c.cmd === 'git' && c.argv.join(' ').startsWith('config --global credential.helper')),
      ).toBe(true);
    });

    it('fails with 79 and no tmux when the marker is missing', async () => {
      const { repo } = resumable();
      const r = await runEntrypoint({ RUN_MODE: 'resume', HOME: mkHome(), AGENTDESK_REPO_DIR: repo }, {});
      expect(r.exitCode).toBe(79);
      expect(r.stdout).toContain('agentdesk: resume failed (no saved session)');
      expect(tmuxCalls(r)).toEqual([]);
    });

    it('fails with 79 when the repo is missing', async () => {
      const { home } = resumable();
      const r = await runEntrypoint({ RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: join(home, 'nope') }, {});
      expect(r.exitCode).toBe(79);
      expect(r.stdout).toContain('agentdesk: resume failed (no saved session)');
      expect(tmuxCalls(r)).toEqual([]);
    });

    it('does not run SETUP_SCRIPT', async () => {
      const { home, repo } = resumable();
      const probe = join(tmpdir(), `resume-probe-${process.pid}-${Date.now()}`);
      const r = await runEntrypoint(
        { RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo, SETUP_SCRIPT: `touch ${probe}` },
        {},
      );
      expect(existsSync(probe)).toBe(false);
      expect(
        r.calls.some((c) => c.cmd === 'timeout' && c.argv[1] !== 'tmux' && !c.argv[2]?.endsWith('transcript.mjs')),
      ).toBe(false);
      expect(started(r)).toBe(true);
    });
  });
});

describe('entrypoint session end', () => {
  const tmuxCalls = (r: Result) => r.calls.filter((c) => c.cmd === 'tmux');

  it('incident: session gone but display-message prints nothing still exits', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'incident' }, {});
    expect(r.stdout).toContain('agentdesk: session ended reason=session_gone code=0');
    expect(r.exitCode).toBe(0);
    expect(tmuxCalls(r).some((c) => c.argv.join(' ') === 'has-session -t =agent')).toBe(true);
  });

  it.each(['incident', 'dead'])('checks before its first sleep when the session is already over (%s)', async (mode) => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: mode }, {});
    expect(r.stdout.at(-1)).toMatch(/^agentdesk: session ended /);
    expect(r.calls.filter((c) => c.cmd === 'sleep')).toEqual([]);
  });

  it('agent exit reports the pane status', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'dead', STUB_PANE_STATUS: '3' }, {});
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=3');
    expect(r.exitCode).toBe(3);
  });

  it('pane commands target the exact session with a trailing colon', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'dead', STUB_PANE_STATUS: '3' }, {});
    for (const sub of ['capture-pane', 'display-message']) {
      const calls = tmuxCalls(r).filter((c) => c.argv.includes(sub));
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c.argv[c.argv.indexOf('-t') + 1]).toBe('=agent:');
    }
  });

  it.each([
    ['', 1],
    ['abc', 1],
    ['-1', 1],
    ['256', 0],
    ['259', 3],
    ['08', 8],
    ['010', 10],
  ])('pane status %j ends with code %i', async (status, code) => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'dead', STUB_PANE_STATUS: status }, {});
    expect(r.stdout.at(-1)).toBe(`agentdesk: session ended reason=agent_exit code=${code}`);
    expect(r.exitCode).toBe(code);
  });

  it('SIGTERM prints the scrollback, then the end line, and exits 0', async () => {
    const r = await runEntrypoint(
      { STUB_TMUX_MODE: 'alive', STUB_GIT_CLONE_DELAY_MS: '2000' },
      {},
      { signalAfterLine: 'agentdesk: session started' },
    );
    const begin = r.stdout.indexOf('agentdesk: final scrollback begin');
    expect(begin).toBeGreaterThan(-1);
    expect(r.stdout.indexOf('agentdesk: final scrollback end')).toBeGreaterThan(begin);
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=signal code=0');
    expect(r.exitCode).toBe(0);
  });

  it('kills the tmux server after the scrollback on every end path', async () => {
    for (const mode of ['incident', 'dead']) {
      const r = await runEntrypoint({ STUB_TMUX_MODE: mode }, {});
      const argvs = tmuxCalls(r).map((c) => c.argv[0]);
      expect(argvs.lastIndexOf('kill-server')).toBeGreaterThan(argvs.lastIndexOf('capture-pane'));
    }
  });
});

describe('entrypoint startup check', () => {
  const STARTUP_LINE = 'agentdesk: state needs_input startup -';
  const runDir = (files: Record<string, string> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'run-'));
    for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
    return dir;
  };
  const alive = { STUB_TMUX_MODE: 'alive', AGENTDESK_STARTUP_WAIT_SECONDS: '1' };

  it('reports needs_input once when no hook has fired within the wait', async () => {
    const r = await runEntrypoint(
      { ...alive, AGENTDESK_RUN_DIR: runDir() },
      {},
      { signalAfterLine: STARTUP_LINE, signalDelayAfterLineMs: 2500 },
    );
    expect(r.stdout.filter((l) => l === STARTUP_LINE)).toHaveLength(1);
  }, 30_000);

  it('says nothing when a hook has already fired', async () => {
    const r = await runEntrypoint(
      { ...alive, AGENTDESK_RUN_DIR: runDir({ 'hook-seen': '' }) },
      {},
      { signalAfterLine: 'agentdesk: session started', signalDelayAfterLineMs: 3000 },
    );
    expect(r.stdout).not.toContain(STARTUP_LINE);
  }, 30_000);

  it('says nothing before the wait is over (default 5 minutes)', async () => {
    const r = await runEntrypoint(
      { STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDir() },
      {},
      { signalAfterLine: 'agentdesk: session started', signalDelayAfterLineMs: 2500 },
    );
    expect(r.stdout).not.toContain(STARTUP_LINE);
  }, 30_000);

  it('ignores a wait that is not plain digits and uses the default', async () => {
    const r = await runEntrypoint(
      { STUB_TMUX_MODE: 'alive', AGENTDESK_STARTUP_WAIT_SECONDS: '1; id', AGENTDESK_RUN_DIR: runDir() },
      {},
      { signalAfterLine: 'agentdesk: session started', signalDelayAfterLineMs: 2500 },
    );
    expect(r.stdout).not.toContain(STARTUP_LINE);
  }, 30_000);
});

describe('entrypoint stop request and agent exit file', () => {
  /** A run dir the test fills before the entrypoint starts (the real one is the in-memory volume /run/agentdesk). */
  const runDirWith = (files: Record<string, string>) => {
    const runDir = mkdtempSync(join(tmpdir(), 'run-dir-'));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(runDir, name), content);
    return runDir;
  };
  const tmuxCalls = (r: Result) => r.calls.filter((c) => c.cmd === 'tmux');

  it('a stop file ends the session with reason stop_request and exit 0', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDirWith({ stop: '' }) }, {});
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=stop_request code=0');
    expect(r.exitCode).toBe(0);
    const argvs = tmuxCalls(r).map((c) => c.argv[0]);
    expect(argvs.lastIndexOf('kill-server')).toBeGreaterThan(argvs.lastIndexOf('capture-pane'));
  });

  it('an agent-exit file ends the session with reason agent_exit and the file code', async () => {
    const r = await runEntrypoint(
      { STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDirWith({ 'agent-exit': '5\n' }) },
      {},
    );
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=5');
    expect(r.exitCode).toBe(5);
  });

  it('the stop file wins over the agent-exit file', async () => {
    const runDir = runDirWith({ stop: '', 'agent-exit': '5\n' });
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDir }, {});
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=stop_request code=0');
    expect(r.exitCode).toBe(0);
  });

  it('both files are checked before the session existence check', async () => {
    const stop = await runEntrypoint({ STUB_TMUX_MODE: 'incident', AGENTDESK_RUN_DIR: runDirWith({ stop: '' }) }, {});
    expect(stop.stdout.at(-1)).toBe('agentdesk: session ended reason=stop_request code=0');
    const exited = await runEntrypoint(
      { STUB_TMUX_MODE: 'incident', AGENTDESK_RUN_DIR: runDirWith({ 'agent-exit': '4' }) },
      {},
    );
    expect(exited.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=4');
    expect(exited.exitCode).toBe(4);
  });

  it('checks before its first sleep when a file is already there', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDirWith({ stop: '' }) }, {});
    expect(r.calls.filter((c) => c.cmd === 'sleep')).toEqual([]);
  });

  // The agent shares the container and can write this file, so its content is untrusted.
  it.each([
    ['', 1],
    ['abc\n', 1],
    ['-1', 1],
    ['5 ; id', 1],
    ['1000', 1],
    ['5\n6\n', 1],
    ['0x10', 1],
    ['256', 0],
    ['259', 3],
    ['08', 8],
    ['010', 10],
    ['255', 255],
    ['0', 0],
  ])('agent-exit content %j ends with code %i', async (content, code) => {
    const r = await runEntrypoint(
      { STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDirWith({ 'agent-exit': content }) },
      {},
    );
    expect(r.stdout.at(-1)).toBe(`agentdesk: session ended reason=agent_exit code=${code}`);
    expect(r.exitCode).toBe(code);
  });

  it('ignores an agent-exit that is not a regular file (a directory, a link) and falls back to the pane', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'run-dir-'));
    mkdirSync(join(runDir, 'agent-exit'));
    const dirRes = await runEntrypoint(
      { STUB_TMUX_MODE: 'dead', STUB_PANE_STATUS: '3', AGENTDESK_RUN_DIR: runDir },
      {},
    );
    expect(dirRes.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=3');
    const linkDir = mkdtempSync(join(tmpdir(), 'run-dir-'));
    const target = join(linkDir, 'elsewhere');
    writeFileSync(target, '9\n');
    symlinkSync(target, join(linkDir, 'agent-exit'));
    const linkRes = await runEntrypoint(
      { STUB_TMUX_MODE: 'dead', STUB_PANE_STATUS: '3', AGENTDESK_RUN_DIR: linkDir },
      {},
    );
    expect(linkRes.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=3');
  });

  // A pipe renamed over a checked agent-exit would block the read for good (and PID 1 defers its TERM trap), so the
  // read is bounded. A `head` that never returns stands in for that pipe; the `timeout` stub ends it after its limit.
  it('does not hang when reading agent-exit blocks: the read is bounded, and the content counts as invalid', async () => {
    const blocker = mkdtempSync(join(tmpdir(), 'blocking-head-'));
    const head = join(blocker, 'head');
    writeFileSync(head, `#!${process.execPath}\nsetTimeout(() => undefined, 120000);\n`, { mode: 0o755 });
    const path = [blocker, join(import.meta.dirname, 'stubs'), dirname(process.execPath), '/usr/bin', '/bin'].join(':');
    const r = await runEntrypoint(
      { PATH: path, STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDirWith({ 'agent-exit': '5\n' }) },
      {},
    );
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=1');
    expect(r.exitCode).toBe(1);
  });

  it('runs the fixed session command through agentdesk-session and passes only that command', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'alive', AGENTDESK_RUN_DIR: runDirWith({ stop: '' }) }, {});
    const argv = tmuxCalls(r).find((c) => c.argv.includes('new-session'))?.argv ?? [];
    expect(argv.slice(-2)).toEqual([join(import.meta.dirname, '..', 'bin', 'agentdesk-session'), START_CMD]);
  });
});

describe('entrypoint git identity', () => {
  const gitConfigs = (r: Result) =>
    r.calls
      .filter((c) => c.cmd === 'git' && c.argv.some((a, i) => a === 'config' && i < 3))
      .map((c) => c.argv.slice(c.argv.indexOf('config') + 1));
  const lastValue = (r: Result, key: string) =>
    gitConfigs(r)
      .filter((c) => c[0] === key)
      .at(-1)?.[1];
  const author = { RUN_AUTHOR_NAME: 'alice', RUN_AUTHOR_EMAIL: '42+alice@users.noreply.github.com' };
  const bot = { BOT_NAME: 'agentdesk[bot]', BOT_EMAIL: 'bot@users.noreply.github.com' };
  const resumable = () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    mkdirSync(join(home, '.agentdesk'));
    writeFileSync(join(home, '.agentdesk/session-started'), '');
    const repo = mkdtempSync(join(tmpdir(), 'repo-'));
    mkdirSync(join(repo, '.git'));
    return { home, repo };
  };

  it('authors commits as the run author, not the bot, on a fresh start', async () => {
    const r = await runEntrypoint({ ...bot, ...author }, {});
    expect(lastValue(r, 'user.name')).toBe('alice');
    expect(lastValue(r, 'user.email')).toBe('42+alice@users.noreply.github.com');
    expect(gitConfigs(r).flat()).not.toContain('agentdesk[bot]');
    expect(r.stdout).toContain('agentdesk: git identity alice 42+alice@users.noreply.github.com');
  });

  it('keeps the bot identity when the Job carries no run author (older Job specs)', async () => {
    const r = await runEntrypoint({ ...bot }, {});
    expect(lastValue(r, 'user.name')).toBe('agentdesk[bot]');
    expect(lastValue(r, 'user.email')).toBe('bot@users.noreply.github.com');
  });

  it('keeps the bot identity when only half of the author is given', async () => {
    const r = await runEntrypoint({ ...bot, RUN_AUTHOR_NAME: 'alice' }, {});
    expect(lastValue(r, 'user.name')).toBe('agentdesk[bot]');
    expect(lastValue(r, 'user.email')).toBe('bot@users.noreply.github.com');
  });

  it("installs the trailer hook in the repo's own hooks dir and leaves core.hooksPath alone", async () => {
    const r = await runEntrypoint({ ...bot, ...author }, {});
    expect(lastValue(r, 'core.hooksPath')).toBeUndefined();
    const repo = r.calls.find((c) => c.cmd === 'git' && c.argv[0] === 'clone')?.argv.at(-1) ?? '';
    const installed = join(repo, '.git', 'hooks', 'prepare-commit-msg');
    expect(readFileSync(installed, 'utf8')).toBe(readFileSync(join(runnerHooks, 'prepare-commit-msg'), 'utf8'));
    expect(statSync(installed).mode & 0o111).not.toBe(0);
  });

  it('keeps a prepare-commit-msg the repo shipped, next to ours as prepare-commit-msg.repo', async () => {
    const r = await runEntrypoint(
      { ...bot, ...author },
      { '.git/hooks/prepare-commit-msg': '#!/bin/sh\n# the repo hook\n' },
    );
    const repo = r.calls.find((c) => c.cmd === 'git' && c.argv[0] === 'clone')?.argv.at(-1) ?? '';
    const dir = join(repo, '.git', 'hooks');
    expect(readFileSync(join(dir, 'prepare-commit-msg.repo'), 'utf8')).toBe('#!/bin/sh\n# the repo hook\n');
    expect(readFileSync(join(dir, 'prepare-commit-msg'), 'utf8')).toBe(
      readFileSync(join(runnerHooks, 'prepare-commit-msg'), 'utf8'),
    );
  });

  it('re-applies the author on a resumed run, whatever the volume held before', async () => {
    const { home, repo } = resumable();
    const r = await runEntrypoint({ RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo, ...bot, ...author }, {});
    expect(lastValue(r, 'user.name')).toBe('alice');
    expect(lastValue(r, 'user.email')).toBe('42+alice@users.noreply.github.com');
    expect(readFileSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'), 'utf8')).toBe(
      readFileSync(join(runnerHooks, 'prepare-commit-msg'), 'utf8'),
    );
    expect(r.calls.some((c) => c.cmd === 'git' && c.argv[0] === 'clone')).toBe(false);
    expect(r.stdout).toContain('agentdesk: git identity alice 42+alice@users.noreply.github.com');
  });

  it('replaces a stale copy of our own hook on a resume instead of chaining to it as the repo hook', async () => {
    const { home, repo } = resumable();
    const hooks = join(repo, '.git', 'hooks');
    mkdirSync(hooks, { recursive: true });
    writeFileSync(
      join(hooks, 'prepare-commit-msg'),
      '#!/bin/sh\n# agentdesk-commit-trailer-hook\n# an older version\n',
    );
    await runEntrypoint({ RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo, ...bot, ...author }, {});
    expect(readFileSync(join(hooks, 'prepare-commit-msg'), 'utf8')).toBe(
      readFileSync(join(runnerHooks, 'prepare-commit-msg'), 'utf8'),
    );
    expect(existsSync(join(hooks, 'prepare-commit-msg.repo'))).toBe(false);
  });

  it('a resumed run with no author in the Job keeps the bot identity', async () => {
    const { home, repo } = resumable();
    const r = await runEntrypoint({ RUN_MODE: 'resume', HOME: home, AGENTDESK_REPO_DIR: repo, ...bot }, {});
    expect(lastValue(r, 'user.name')).toBe('agentdesk[bot]');
  });
});

describe('entrypoint transcript flush', () => {
  const callNames = (r: Result) =>
    r.calls.map((c) => {
      if (c.cmd === 'tmux') return `tmux ${c.argv[0]}`;
      if (c.cmd === 'timeout' && c.argv[2]?.endsWith('transcript.mjs')) return `flush ${c.argv[0]} ${c.argv[3]}`;
      if (c.cmd === 'timeout') return `timeout ${c.argv[1]}`;
      return c.cmd;
    });

  // A lib dir that links everything in the runner dir, with agents/claude/transcript.mjs replaced (or left out).
  const libWith = (transcript: string | null) => {
    const root = join(import.meta.dirname, '..');
    const lib = mkdtempSync(join(tmpdir(), 'lib-'));
    for (const name of readdirSync(root)) {
      if (name !== 'agents' && name !== 'node_modules' && name !== 'test')
        symlinkSync(join(root, name), join(lib, name));
    }
    mkdirSync(join(lib, 'agents', 'claude'), { recursive: true });
    for (const name of readdirSync(join(root, 'agents', 'claude'))) {
      if (name !== 'transcript.mjs')
        symlinkSync(join(root, 'agents', 'claude', name), join(lib, 'agents', 'claude', name));
    }
    if (transcript !== null) writeFileSync(join(lib, 'agents', 'claude', 'transcript.mjs'), transcript);
    return lib;
  };

  it('flush runs right after session started and at the start of end_session, before the scrollback', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'dead' }, {});
    const names = callNames(r);
    const flushes = names.flatMap((n, i) => (n.startsWith('flush') ? [i] : []));
    expect(names.filter((n) => n.startsWith('flush'))).toEqual(['flush 5 flush', 'flush 5 flush']);
    const [first = -1, second = -1] = flushes;
    expect(first).toBeGreaterThan(names.indexOf('tmux new-session'));
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(names.indexOf('timeout tmux'));
    expect(r.stdout.indexOf('agentdesk: session started')).toBeLessThan(
      r.stdout.indexOf('agentdesk: final scrollback begin'),
    );
  });

  it('flush is skipped when the agent dir has no transcript.mjs', async () => {
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'dead', AGENTDESK_LIB_DIR: libWith(null) }, {});
    expect(callNames(r).filter((n) => n.startsWith('flush'))).toEqual([]);
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=0');
  });

  it('a flush that hangs is cut off by timeout 5 and the session still ends', async () => {
    const lib = libWith('setInterval(() => {}, 1000);\n');
    const r = await runEntrypoint({ STUB_TMUX_MODE: 'dead', AGENTDESK_LIB_DIR: lib }, {});
    expect(r.stdout).toContain('agentdesk: final scrollback end');
    expect(r.stdout.at(-1)).toBe('agentdesk: session ended reason=agent_exit code=0');
    expect(r.exitCode).toBe(0);
  }, 30_000);
});
