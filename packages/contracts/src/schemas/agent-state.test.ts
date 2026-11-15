import { describe, expect, it } from 'vitest';
import {
  ACTIVE_RUN_STATUSES,
  AgentNote,
  FINAL_RUN_STATUSES,
  FINISHABLE_RUN_STATUSES,
  RunStatus,
  toAgentNote,
  toAgentNoteWire,
} from '../index';

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

describe('toAgentNoteWire', () => {
  it('sanitizes like toAgentNote but keeps up to 1000 chars for redaction before the 500 cap', () => {
    expect(toAgentNoteWire('a\nb\u001b')).toBe('a b');
    expect(toAgentNoteWire('x'.repeat(1500)).length).toBe(1000);
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
    expect([...FINISHABLE_RUN_STATUSES]).toEqual(['idle', 'done', 'paused']);
  });
});

describe('pause statuses', () => {
  it('knows paused and expired', () => {
    expect(RunStatus.parse('paused')).toBe('paused');
    expect(RunStatus.parse('expired')).toBe('expired');
  });
  it('puts expired in final, paused in neither active nor final', () => {
    expect(FINAL_RUN_STATUSES).toContain('expired');
    expect(FINAL_RUN_STATUSES).not.toContain('paused');
    expect(ACTIVE_RUN_STATUSES).not.toContain('paused');
  });
});
