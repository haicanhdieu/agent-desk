import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { selectPlugins, usableMarketplaces } from '../src/plugins/select-plugins';

interface Case {
  name: string;
  settings: string | null;
  marketplaces: Record<string, string>;
  install: string[];
  skipped: string[];
}

// The same file the runner's test reads, so the panel (this twin) and the pod cannot disagree.
const fixturePath = fileURLToPath(
  new URL('../../../images/runner/test/fixtures/plugin-selection.json', import.meta.url),
);
const cases = JSON.parse(readFileSync(fixturePath, 'utf8')) as Case[];

const toIds = (r: ReturnType<typeof selectPlugins>) => ({
  install: r.install.map((i) => `${i.plugin}@${i.store}`),
  skipped: r.skipped,
});

describe('selectPlugins (twin of the runner)', () => {
  it('has the shared fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(11);
  });

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

describe('usableMarketplaces', () => {
  it('keeps valid entries', () => {
    expect(usableMarketplaces({ a: 'o/r' })).toEqual({ a: 'o/r' });
  });

  it.each([['\t'], ['\n'], ['\r'], ['\u0000']])('drops a source containing control char %j', (ch) => {
    expect(usableMarketplaces({ s: `o/${ch}s` })).toEqual({});
  });

  it('drops empty sources and invalid store names', () => {
    expect(usableMarketplaces({ s: '', 'Bad Name': 'o/r', ok: 'o/r' })).toEqual({ ok: 'o/r' });
  });
});
