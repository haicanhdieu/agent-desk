import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUN_STATUSES, statusTokens } from './tokens';

const css = readFileSync(resolve(process.cwd(), 'src/ds/tokens.css'), 'utf8')
  .replace(/\s+/g, '')
  .toLowerCase();

const core: Record<string, string> = {
  bg: '#15181E', panel: '#1B1F26', raised: '#232832', line: '#2C323D', line2: '#3A4150',
  text: '#E3E6EB', muted: '#A3ABB8', faint: '#8A93A2', accent: '#93A9FF', term: '#0F1216',
  run: '#52C4D9', idle: '#F5B83D', ok: '#6CCF96', fail: '#F2776B', late: '#EE9A57', off: '#9AA2AF',
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
});

describe('statusTokens', () => {
  it('covers the 8 statuses', () => {
    expect(Object.keys(statusTokens)).toEqual([...RUN_STATUSES]);
    expect(RUN_STATUSES).toHaveLength(8);
  });
  it('has labels and color vars', () => {
    expect(statusTokens.idle.label).toBe('Needs you');
    expect(statusTokens.timed_out.label).toBe('Timed out');
    expect(statusTokens.cancelled.colorVar).toBe('--off');
    expect(statusTokens.starting.colorVar).toBe('--run');
  });
});
