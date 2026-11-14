import { describe, expect, it } from 'vitest';
import { AgentNote, FINISHABLE_RUN_STATUSES, RunStatus, toAgentNote } from '../index';

describe('toAgentNote', () => {
  it('collapses line terminators and control chars to a space', () => {
    const out = toAgentNote('a\nb\r\nc\u001b[31m');
    expect(out).toBe('a b c [31m');
    expect(out).not.toContain('\u001b');
  });

  it('caps the note at 500 chars', () => {
    expect(toAgentNote('x'.repeat(600)).length).toBe(500);
  });
});

describe('AgentNote', () => {
  it('rejects line terminators', () => {
    expect(AgentNote.safeParse('a\nb').success).toBe(false);
  });
  it('accepts a single-line note', () => {
    expect(AgentNote.safeParse('ok').success).toBe(true);
  });
});

describe('run status', () => {
  it('accepts done', () => {
    expect(RunStatus.parse('done')).toBe('done');
  });
  it('lists finishable statuses', () => {
    expect([...FINISHABLE_RUN_STATUSES]).toEqual(['idle', 'done']);
  });
});
