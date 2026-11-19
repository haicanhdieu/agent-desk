import { describe, expect, it } from 'vitest';
import type { TranscriptWireEntry } from '@agentdesk/contracts';
import { toTranscriptRow } from '../src/activities/transcript-store';

const NOW = new Date('2026-11-19T12:00:00.000Z');
const wire = (text: string, over: Partial<TranscriptWireEntry> = {}): TranscriptWireEntry => ({
  id: 'a',
  kind: 'agent',
  text,
  ...over,
});

describe('toTranscriptRow secret and NUL safety', () => {
  it('drops the cut final token of a truncated entry so half a secret is never stored', () => {
    const cut = `${'word '.repeat(10)}sk-ant-ABCDEFGH`;
    const row = toTranscriptRow(wire(cut, { truncated: true }), [], NOW);
    expect(row.text).not.toContain('sk-ant');
    expect(row.text).toBe('word '.repeat(10).trimEnd());
    expect(toTranscriptRow(wire(cut), [], NOW).text).toBe(cut);
  });

  it('drops the cut final token of a tool summary at its 200-char cap', () => {
    const capped = `${'y '.repeat(95)}ghs_AAAAAAAAAA`.slice(0, 200);
    expect(capped.length).toBe(200);
    const row = toTranscriptRow({ id: 't:0', kind: 'tool', tool: 'Other', text: capped }, [], NOW);
    expect(row.text).not.toContain('ghs_');
  });

  it('keeps a short tool summary whole', () => {
    const row = toTranscriptRow({ id: 't:0', kind: 'tool', tool: 'Bash', text: 'ls -la' }, [], NOW);
    expect(row.text).toBe('ls -la');
  });

  it('keeps a complete long Bash command and a long unbroken Read path whole', () => {
    const cmd = `${'echo hello '.repeat(22)}done`;
    expect(cmd.length).toBeGreaterThan(200);
    expect(toTranscriptRow({ id: 't:0', kind: 'tool', tool: 'Bash', text: cmd }, [], NOW).text).toBe(cmd);
    const path = `/${'a'.repeat(250)}`;
    const row = toTranscriptRow({ id: 't:1', kind: 'tool', tool: 'Read', text: path }, [], NOW);
    expect(row.text).toBe(path);
    expect(row.truncated).toBe(false);
  });

  it('marks a row truncated when dropping the cut token leaves nothing', () => {
    const one = `ghs_${'A'.repeat(300)}`;
    const row = toTranscriptRow({ id: 't:0', kind: 'tool', tool: 'Other', text: one }, [], NOW);
    expect(row.text).toBe('');
    expect(row.truncated).toBe(true);
  });

  it('marks a cut tool summary truncated', () => {
    const capped = `${'y '.repeat(95)}ghs_AAAAAAAAAA`.slice(0, 200);
    const row = toTranscriptRow({ id: 't:0', kind: 'tool', tool: 'Other', text: capped }, [], NOW);
    expect(row.truncated).toBe(true);
  });

  it('replaces a NUL character, which Postgres text rejects', () => {
    expect(toTranscriptRow(wire('a\u0000b'), [], NOW).text).toBe('a�b');
  });
});
