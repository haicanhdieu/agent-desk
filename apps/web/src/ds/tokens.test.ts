import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PR_STATES, prStateTokens, RUN_STATUSES, statusTokens } from './tokens';

const css = readFileSync(resolve(process.cwd(), 'src/ds/tokens.css'), 'utf8').replace(/\s+/g, '').toLowerCase();

const core: Record<string, string> = {
  bg: '#15181E',
  panel: '#1B1F26',
  raised: '#232832',
  line: '#2C323D',
  line2: '#3A4150',
  text: '#E3E6EB',
  muted: '#A3ABB8',
  faint: '#8A93A2',
  accent: '#93A9FF',
  term: '#0F1216',
  run: '#52C4D9',
  idle: '#F5B83D',
  ok: '#6CCF96',
  fail: '#F2776B',
  late: '#EE9A57',
  off: '#9AA2AF',
};

describe('tokens.css', () => {
  it.each(Object.entries(core))('defines --%s', (name, value) => {
    expect(css).toContain(`--${name}:${value.toLowerCase()}`);
  });
  it.each(['--radius-pill:999px', '--fs-9_5:9.5px', '--input-bg:#12151a', '--banner-idle-line:var(--idle)'])(
    'defines %s',
    (decl) => expect(css).toContain(decl),
  );
  it('defines the font stacks', () => {
    expect(css).toContain("--sans:'ibmplexsans'");
    expect(css).toContain("--mono:'ibmplexmono'");
  });
  // Claude Code draws block, box and geometric glyphs (the logo, the bullets); xterm's DOM renderer draws them with
  // the font, so the terminal stack keeps the UI font first and adds faces that cover those ranges. The UI --mono
  // token stays as it is.
  it('defines a terminal font stack that keeps IBM Plex Mono first and adds glyph-covering fallbacks', () => {
    const stack = /--term-mono:([^;]*);/.exec(css)?.[1] ?? '';
    expect(stack.startsWith("'ibmplexmono',")).toBe(true);
    for (const face of ["'dejavusansmono'", "'applesymbols'", "'segoeuisymbol'", "'notosanssymbols2'"]) {
      expect(stack).toContain(face);
    }
    expect(stack.endsWith(',monospace')).toBe(true);
  });
});

describe('statusTokens', () => {
  it('covers the 11 statuses', () => {
    expect(Object.keys(statusTokens)).toEqual([...RUN_STATUSES]);
    expect(RUN_STATUSES).toHaveLength(11);
  });
  it('has labels and color vars', () => {
    expect(statusTokens.idle.label).toBe('Needs you');
    expect(statusTokens.timed_out.label).toBe('Timed out');
    expect(statusTokens.cancelled.colorVar).toBe('--off');
    expect(statusTokens.starting.colorVar).toBe('--run');
  });
});

describe('pull request state tokens', () => {
  it.each(['--pr-open:var(--ok)', '--pr-draft:var(--faint)', '--pr-merged:#c8a2f0', '--pr-closed:var(--fail)'])(
    'defines %s',
    (decl) => expect(css).toContain(decl),
  );
  it.each(PR_STATES)('maps %s to a defined css variable', (s) => {
    expect(css).toContain(`${prStateTokens[s].colorVar}:`);
  });
  it('uses the words Open, Draft, Merged, Closed', () => {
    expect(PR_STATES.map((s) => prStateTokens[s].label)).toEqual(['Open', 'Draft', 'Merged', 'Closed']);
  });
});
