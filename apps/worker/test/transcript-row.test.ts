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

  it('marks a row truncated and empty when the whole text is a cut secret prefix', () => {
    const one = 'ghs_AAAAAAAAAA';
    const row = toTranscriptRow(wire(one, { truncated: true }), [], NOW);
    expect(row.text).toBe('');
    expect(row.truncated).toBe(true);
  });

  it('keeps a 200-char whitespace-free summary of a non-Bash tool whole (BR-40)', () => {
    const text = JSON.stringify({ pattern: 'x'.repeat(200) }).slice(0, 200);
    expect(text.length).toBe(200);
    const row = toTranscriptRow({ id: 't:0', kind: 'tool', tool: 'Grep', text }, [], NOW);
    expect(row.text).toBe(text);
  });

  it('keeps an 8000-char whitespace-free truncated text whole (BR-44)', () => {
    const text = 'b'.repeat(8000);
    const row = toTranscriptRow(wire(text, { truncated: true }), [], NOW);
    expect(row.text).toBe(text);
    expect(row.truncated).toBe(true);
  });

  it('drops a cut tail that is the start of a known secret, keeping the text before it', () => {
    const secret = 'topsecretvalue-1234567890';
    const row = toTranscriptRow(wire(`before ${secret.slice(0, 15)}`, { truncated: true }), [secret], NOW);
    expect(row.text).toBe('before');
  });

  it('drops a cut secret prefix glued to other text, but not on an untruncated entry', () => {
    const secret = 'topsecretvalue-1234567890';
    const glued = `prefix:${secret.slice(0, 12)}`;
    expect(toTranscriptRow(wire(glued, { truncated: true }), [secret], NOW).text).toBe('prefix:');
    expect(toTranscriptRow(wire(glued), [secret], NOW).text).toBe(glued);
  });

  it('still redacts a whole known secret inside a cut text', () => {
    const secret = 'topsecretvalue-1234567890';
    const row = toTranscriptRow(wire(`a ${secret} b`, { truncated: true }), [secret], NOW);
    expect(row.text).toBe('a *** b');
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

describe('toTranscriptRow cut starts of secrets and token patterns', () => {
  it.each(['x-acce', 'x-access-token', 'x-access-token:abc', 'sk-an', 'sk-ant-', 'ghs_', 'ghs_AB'])(
    'drops a cut text ending in the start of a token pattern: %s',
    (tail) => {
      const row = toTranscriptRow(wire(`word ${tail}`, { truncated: true }), [], NOW);
      expect(row.text).toBe('word');
      expect(toTranscriptRow(wire(`word ${tail}`), [], NOW).text).toBe(`word ${tail}`);
    },
  );

  it('keeps a cut text ending in a short pattern fragment, which holds no secret', () => {
    for (const tail of ['x', 'x-', 'gh', 'sk', 'sk-']) {
      expect(toTranscriptRow(wire(`word ${tail}`, { truncated: true }), [], NOW).text).toBe(`word ${tail}`);
    }
  });

  it.each([1, 2, 3])('drops the first %i chars of a known secret from the end of a cut text', (k) => {
    const secret = 'topsecretvalue-1234567890';
    const row = toTranscriptRow(wire(`before ${secret.slice(0, k)}`, { truncated: true }), [secret], NOW);
    expect(row.text).toBe('before');
    expect(row.truncated).toBe(true);
  });

  it('keeps ordinary cut text whole when it does not end in the start of a known secret', () => {
    const secret = 'topsecretvalue-1234567890';
    expect(toTranscriptRow(wire('a b c d', { truncated: true }), [secret], NOW).text).toBe('a b c d');
  });
});
