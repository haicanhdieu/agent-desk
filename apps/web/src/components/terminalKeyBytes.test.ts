import { describe, expect, it } from 'vitest';
import { terminalKeyBytes } from './terminalKeyBytes';

describe('terminalKeyBytes', () => {
  it.each([
    ['esc', '\x1b'],
    ['tab', '\t'],
    ['enter', '\r'],
    ['ctrl-c', '\x03'],
    ['up', '\x1b[A'],
    ['down', '\x1b[B'],
    ['right', '\x1b[C'],
    ['left', '\x1b[D'],
  ] as const)('%s sends its bytes in normal cursor mode', (key, bytes) => {
    expect(terminalKeyBytes(key, false)).toBe(bytes);
  });

  it.each([
    ['up', '\x1bOA'],
    ['down', '\x1bOB'],
    ['right', '\x1bOC'],
    ['left', '\x1bOD'],
  ] as const)('%s sends the ESC O form in application cursor mode', (key, bytes) => {
    expect(terminalKeyBytes(key, true)).toBe(bytes);
  });

  it.each([
    ['esc', '\x1b'],
    ['tab', '\t'],
    ['enter', '\r'],
    ['ctrl-c', '\x03'],
  ] as const)('%s is unchanged in application cursor mode', (key, bytes) => {
    expect(terminalKeyBytes(key, true)).toBe(bytes);
  });
});
