import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { selectPlugins } from '../select-plugins.mjs';

const run = promisify(execFile);
const script = join(import.meta.dirname, '..', 'select-plugins.mjs');

interface Case {
  name: string;
  settings: string | null;
  marketplaces: Record<string, string>;
  install: string[];
  skipped: string[];
}

const cases = JSON.parse(
  await readFile(join(import.meta.dirname, 'fixtures', 'plugin-selection.json'), 'utf8'),
) as Case[];

const toIds = (r: ReturnType<typeof selectPlugins>) => ({
  install: r.install.map((i) => `${i.plugin}@${i.store}`),
  skipped: r.skipped,
});

describe('selectPlugins', () => {
  it.each(cases)('$name', (c) => {
    expect(toIds(selectPlugins(c.settings, c.marketplaces))).toEqual({ install: c.install, skipped: c.skipped });
  });

  it('installs from the configured source, not the repo one', () => {
    const c = cases.find((x) => x.name === 'repo extraKnownMarketplaces is ignored');
    if (!c) throw new Error('fixture case missing');
    expect(selectPlugins(c.settings, c.marketplaces).install).toEqual([
      { plugin: 'superpowers', store: 'claude-plugins-official', source: 'anthropics/claude-plugins-official' },
    ]);
  });
});

describe('select-plugins CLI', () => {
  const runCli = async (settings: string | null, marketplaces: string | undefined) => {
    const dir = await mkdtemp(join(tmpdir(), 'select-plugins-'));
    const file = join(dir, 'settings.json');
    if (settings !== null) await writeFile(file, settings);
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
    if (marketplaces !== undefined) env.PLUGIN_MARKETPLACES = marketplaces;
    return run(process.execPath, [script, file], { env });
  };
  const settings = JSON.stringify({ enabledPlugins: { 'b@s': true, 'a@s': true, 'c@other': true } });
  const market = JSON.stringify({ s: 'o/s' });

  it('prints tab-separated install and skip lines', async () => {
    const { stdout } = await runCli(settings, market);
    expect(stdout).toBe('install\ta\ts\to/s\ninstall\tb\ts\to/s\nskip\tc@other\n');
  });

  it.each([
    ['missing file', null, market],
    ['invalid json', 'nope', market],
    ['invalid marketplaces', settings, 'nope'],
    ['non-object marketplaces', settings, '[]'],
    ['unset marketplaces', settings, undefined],
  ])('prints nothing for %s', async (_n, s, m) => {
    const { stdout } = await runCli(s, m);
    expect(stdout).toBe('');
  });
});
