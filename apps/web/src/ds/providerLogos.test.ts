import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_KIND_CAPABILITIES, AGENT_KINDS_COMING_SOON } from '@agentdesk/contracts';
import { providerLogos } from './providerLogos';

/** Kinds that show the monogram on purpose, one reason each. A kind that gains a logo must leave this list. */
const MONOGRAM_ONLY: Record<string, string> = {
  aider:
    'The only mark found is a traced bitmap that needs a transform to draw, and its logo terms are not stated (unconfirmed).',
};

const logoKeys = [
  ...Object.values(AGENT_KIND_CAPABILITIES).map((c) => c.logo),
  ...AGENT_KINDS_COMING_SOON.map((c) => c.logo),
];

describe('providerLogos', () => {
  it('covers every kind derived from contracts', () => {
    expect(logoKeys).toHaveLength(Object.keys(AGENT_KIND_CAPABILITIES).length + AGENT_KINDS_COMING_SOON.length);
  });

  it.each(logoKeys)('%s has an entry or is on the monogram-only allow-list', (key) => {
    expect(key in providerLogos || key in MONOGRAM_ONLY).toBe(true);
  });

  it('has no stale allow-list entry', () => {
    for (const key of Object.keys(MONOGRAM_ONLY)) {
      expect(logoKeys).toContain(key);
      expect(providerLogos).not.toHaveProperty(key);
    }
  });

  it('has no entry for an unknown kind', () => {
    for (const key of Object.keys(providerLogos)) expect(logoKeys).toContain(key);
  });

  it('keeps OpenCode, which is runnable, with its official source', () => {
    expect(providerLogos.opencode?.source).toBe('https://opencode.ai/brand');
  });

  it.each(Object.entries(providerLogos))('%s has a source, a viewBox and plain path data', (_key, logo) => {
    expect(logo.source).toMatch(/^https:\/\//);
    expect(logo.viewBox).toMatch(/^0 0 [\d.]+ [\d.]+$/);
    expect(logo.paths.length).toBeGreaterThan(0);
    for (const d of logo.paths) {
      expect(d.length).toBeGreaterThan(0);
      expect(d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/);
    }
  });

  it('holds no fill, stroke or hex colour in the module', () => {
    const src = readFileSync(resolve(__dirname, 'providerLogos.ts'), 'utf8');
    expect(src).not.toMatch(/fill|stroke|#[0-9a-fA-F]{3,8}\b/);
  });
});
