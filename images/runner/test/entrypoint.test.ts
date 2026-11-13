import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEntrypoint } from './harness.js';

type Result = Awaited<ReturnType<typeof runEntrypoint>>;

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
    expect(r.calls.filter((c) => c.cmd === 'timeout').map((c) => c.argv[0])).toEqual(['120', '120', '120']);
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
