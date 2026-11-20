import { describe, expect, it } from 'vitest';
import { parseLogLine } from '../../src/kube/log-parser';

const SHA = 'a'.repeat(40);

describe('parseLogLine workspace markers', () => {
  it.each([
    [`agentdesk: checkout ${SHA}`, 'checkout', { sha: SHA }],
    ['agentdesk: plugins begin', 'plugins_begin', {}],
    [
      'agentdesk: plugin installed foo@claude-plugins-official',
      'plugin_installed',
      { pluginId: 'foo@claude-plugins-official' },
    ],
    ['agentdesk: plugin skipped foo@other (store not approved)', 'plugin_skipped', { pluginId: 'foo@other' }],
    ['agentdesk: plugin failed foo@bar\r', 'plugin_failed', { pluginId: 'foo@bar' }],
    ['agentdesk: plugins end', 'plugins_end', {}],
    ['agentdesk: setup begin', 'setup_begin', {}],
    ['agentdesk: setup skipped (no script)', 'setup_skipped', {}],
    ['agentdesk: setup passed', 'setup_passed', {}],
    ['agentdesk: setup failed exit=7', 'setup_failed', { exitCode: 7 }],
    ['agentdesk: setup timed out', 'setup_timed_out', {}],
  ] as const)('%j -> %s', (line, kind, extra) => {
    expect(parseLogLine(line)).toEqual({ kind, text: line.trim(), ...extra });
  });

  it('strips the output prefixes', () => {
    expect(parseLogLine('setup| agentdesk: session started')).toEqual({
      kind: 'setup_output',
      text: 'agentdesk: session started',
    });
    expect(parseLogLine('plugin| installing...')).toEqual({ kind: 'plugin_output', text: 'installing...' });
  });

  it.each([
    'agentdesk: plugin installed BAD ID',
    'agentdesk: plugin installed -x@y',
    'agentdesk: plugin installed foo',
    'agentdesk: plugin failed Foo@bar',
    'agentdesk: plugin skipped foo@bar',
    'agentdesk: checkout abc',
    `agentdesk: checkout ${'g'.repeat(40)}`,
    'agentdesk: setup failed exit=abc',
    'agentdesk: setup failed exit=',
    'agentdesk: setup passed now',
  ])('%j is text', (line) => {
    expect(parseLogLine(line)).toEqual({ kind: 'text', text: line });
  });
});

describe('parseLogLine', () => {
  it.each([
    ['agentdesk: session started', 'session_started'],
    ['agentdesk: final scrollback begin', 'scrollback_begin'],
    ['agentdesk: final scrollback end', 'scrollback_end'],
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
    expect(parseLogLine('agentdesk: session started\r')).toEqual({
      kind: 'session_started',
      text: 'agentdesk: session started',
    });
  });
});

describe('parseLogLine agent state protocol', () => {
  const b64 = (s: string): string => Buffer.from(s).toString('base64');

  it.each([
    ['agentdesk: state working', { state: 'working' }],
    ['agentdesk: state waiting background', { state: 'waiting', waitingOn: 'background' }],
    ['agentdesk: state needs_input question -', { state: 'needs_input', source: 'question' }],
    ['agentdesk: state done declared -', { state: 'done', source: 'declared' }],
    [
      `agentdesk: state needs_input approval ${b64('Ship it?\nyes')}`,
      { state: 'needs_input', source: 'approval', note: 'Ship it? yes' },
    ],
    [`agentdesk: state done declared ${b64('All done')}`, { state: 'done', source: 'declared', note: 'All done' }],
    ['agentdesk: state needs_input startup -', { state: 'needs_input', source: 'startup' }],
    ['agentdesk: turn started', { state: 'working' }],
    ['agentdesk: turn finished', { state: 'needs_input', source: 'undeclared' }],
  ] as const)('%j maps to %j (with and without CR)', (line, agent) => {
    for (const l of [line, `${line}\r`]) {
      expect(parseLogLine(l)).toEqual({ kind: 'agent_state', text: line, agent });
    }
  });

  it('keeps up to 1000 chars of note so the worker can redact before capping', () => {
    const line = `agentdesk: state done declared ${b64('y'.repeat(1500))}`;
    expect(parseLogLine(line).agent?.note).toBe('y'.repeat(1000));
  });

  it('accepts a 1000-char note made of 4-byte characters', () => {
    const line = `agentdesk: state done declared ${b64('\u{1F600}'.repeat(500))}`;
    expect(parseLogLine(line).agent?.note).toBeDefined();
  });

  it('omits the note when the payload decodes to nothing', () => {
    expect(parseLogLine(`agentdesk: state done declared ${b64(' \n ')}`).agent).toEqual({
      state: 'done',
      source: 'declared',
    });
  });

  it.each([
    'agentdesk: state done maybe -',
    'agentdesk: state done declared a b',
    `agentdesk: state done declared ${'A'.repeat(5401)}`,
    'agentdesk: state done declared - extra',
    'xagentdesk: state working',
    'agentdesk: state working now',
  ])('%j stays text', (line) => {
    expect(parseLogLine(line)).toEqual({ kind: 'text', text: line });
  });
});

describe('parseLogLine session end marker', () => {
  it.each(['stop_request', 'agent_exit', 'session_gone', 'signal'] as const)('accepts reason=%s', (reason) => {
    const line = `agentdesk: session ended reason=${reason} code=137`;
    expect(parseLogLine(line)).toEqual({ kind: 'session_ended', text: line, end: { reason, code: 137 } });
  });

  it('ignores surrounding whitespace and reads the code as a decimal number', () => {
    expect(parseLogLine('agentdesk: session ended reason=agent_exit code=007\r').end).toEqual({
      reason: 'agent_exit',
      code: 7,
    });
  });

  it.each([
    'agentdesk: session ended reason=evil code=1',
    'agentdesk: session ended reason=signal code=1 extra',
    'agentdesk: session ended reason=signal code=1234',
    'agentdesk: session ended reason=signal code=',
    'agentdesk: session ended reason=signal code=-1',
    'agentdesk: session ended reason=signal',
    'agentdesk: session ended reason=signal code=1\nagentdesk: session ended reason=signal code=2',
    'x agentdesk: session ended reason=signal code=1',
  ])('treats %j as an ordinary log line', (line) => {
    expect(parseLogLine(line)).toEqual({ kind: 'text', text: line });
  });
});

describe('parseLogLine transcript lines', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
  const entry = { id: 'u1:0', kind: 'agent', text: 'hi' };

  it('parses a valid line into a transcript entry and keeps the encoded body out of text', () => {
    const line = `agentdesk: transcript ${b64(JSON.stringify(entry))}`;
    expect(parseLogLine(line)).toEqual({ kind: 'transcript', text: '', transcript: entry });
  });

  it('ignores surrounding whitespace like the other markers', () => {
    const line = `  agentdesk: transcript ${b64(JSON.stringify(entry))} \r`;
    expect(parseLogLine(line).kind).toBe('transcript');
  });

  it.each([
    ['a body of 12,001 chars', `agentdesk: transcript ${'A'.repeat(12001)}`],
    ['a body with characters outside base64', 'agentdesk: transcript !!!'],
    ['a body whose length is not a multiple of 4', `agentdesk: transcript ${b64(JSON.stringify(entry)).slice(0, -1)}`],
    ['base64 of text that is not JSON', `agentdesk: transcript ${b64('not json')}`],
    ['an entry that fails the schema', `agentdesk: transcript ${b64('{ "id": "a b", "kind": "agent", "text": "x" }')}`],
    ['a missing body', 'agentdesk: transcript '],
    ['text before the marker', `x agentdesk: transcript ${b64(JSON.stringify(entry))}`],
  ])('treats %s as an ordinary text line', (_name, line) => {
    expect(parseLogLine(line)).toEqual({ kind: 'text', text: line });
  });
});
