import { describe, expect, it } from 'vitest';
import { RunTranscriptQuery, RunTranscriptResponse, TranscriptWireEntry } from './transcript';

describe('TranscriptWireEntry', () => {
  it('accepts an agent entry and a full tool entry', () => {
    expect(TranscriptWireEntry.safeParse({ id: 'a1b2:0', kind: 'agent', text: 'hi' }).success).toBe(true);
    expect(
      TranscriptWireEntry.safeParse({
        id: 'x',
        kind: 'tool',
        tool: 'Bash',
        text: 'dotnet test',
        at: '2026-11-19T14:13:00.000Z',
        truncated: true,
      }).success,
    ).toBe(true);
  });

  it.each([
    ['empty id', { id: '', kind: 'agent', text: 'a' }],
    ['id too long', { id: 'a'.repeat(129), kind: 'agent', text: 'a' }],
    ['id with space', { id: 'a b', kind: 'agent', text: 'a' }],
    ['id with slash', { id: 'a/b', kind: 'agent', text: 'a' }],
    ['unknown kind', { id: 'a', kind: 'thinking', text: 'a' }],
    ['empty tool', { id: 'a', kind: 'tool', tool: '', text: 'a' }],
    ['tool too long', { id: 'a', kind: 'tool', tool: 'a'.repeat(65), text: 'a' }],
    ['tool on a user entry', { id: 'a', kind: 'user', tool: 'Bash', text: 'a' }],
    ['bad timestamp', { id: 'a', kind: 'agent', text: 'a', at: 'yesterday' }],
  ])('rejects %s', (_name, value) => {
    expect(TranscriptWireEntry.safeParse(value).success).toBe(false);
  });

  it('text limit counts UTF-8 bytes', () => {
    const parse = (text: string) => TranscriptWireEntry.safeParse({ id: 'a', kind: 'agent', text }).success;
    expect(parse('a'.repeat(8000))).toBe(true);
    expect(parse('a'.repeat(8001))).toBe(false);
    expect(parse('é'.repeat(4000))).toBe(true);
    expect(parse('é'.repeat(4000) + 'a')).toBe(false);
  });
});

describe('RunTranscriptQuery', () => {
  it('defaults the limit to 200', () => {
    expect(RunTranscriptQuery.parse({})).toEqual({ limit: 200 });
  });
  it('coerces strings', () => {
    expect(RunTranscriptQuery.parse({ limit: '500', before: '7' })).toEqual({ limit: 500, before: 7 });
  });
  it.each([{ limit: 0 }, { limit: 501 }, { before: 0 }, { before: 2147483648 }])('rejects %j', (q) => {
    expect(RunTranscriptQuery.safeParse(q).success).toBe(false);
  });
});

describe('RunTranscriptResponse', () => {
  it('parses an empty page', () => {
    expect(RunTranscriptResponse.parse({ items: [], nextBefore: null })).toEqual({ items: [], nextBefore: null });
  });
});
