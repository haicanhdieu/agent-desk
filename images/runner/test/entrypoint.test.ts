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
