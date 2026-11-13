import { describe, expect, it } from 'vitest';
import { parseLogLine } from '../../src/kube/log-parser';

describe('parseLogLine', () => {
  it.each([
    ['agentdesk: session started', 'session_started'],
    ['agentdesk: turn started', 'turn_started'],
    ['agentdesk: turn finished', 'turn_finished'],
    ['agentdesk: final scrollback begin', 'scrollback_begin'],
    ['agentdesk: final scrollback end', 'scrollback_end'],
    ['agentdesk: turn finished\r', 'turn_finished'],
    ['  agentdesk: session started  ', 'session_started'],
  ] as const)('%j → %s', (line, kind) => {
    expect(parseLogLine(line).kind).toBe(kind);
  });

  it.each([
    'Cloning into /workspace...',
    'agentdesk: session started now',
    'xagentdesk: turn finished',
    'agentdesk: turn started now',
    '',
  ])('%j is text, kept verbatim', (line) => {
    expect(parseLogLine(line)).toEqual({ kind: 'text', text: line });
  });

  it('carries the trimmed marker text for lifecycle lines', () => {
    expect(parseLogLine('agentdesk: turn finished\r')).toEqual({
      kind: 'turn_finished',
      text: 'agentdesk: turn finished',
    });
  });
});
