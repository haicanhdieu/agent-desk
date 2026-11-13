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
