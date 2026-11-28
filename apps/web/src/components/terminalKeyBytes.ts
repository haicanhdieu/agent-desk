import type { TerminalKey } from './TerminalKeys';

// The bytes a hardware keyboard would send for each extra key (BR-67). A fixed table: no ticket or user text goes in,
// and nothing is logged. Arrows depend on the program's cursor mode (DECCKM): ESC [ x normally, ESC O x in application mode.

const FIXED: Record<Exclude<TerminalKey, 'up' | 'down' | 'right' | 'left'>, string> = {
  esc: '\x1b',
  tab: '\t',
  enter: '\r',
  'ctrl-c': '\x03',
};

const ARROW_LETTER = { up: 'A', down: 'B', right: 'C', left: 'D' } as const;

export function terminalKeyBytes(key: TerminalKey, applicationCursor: boolean): string {
  if (key === 'up' || key === 'down' || key === 'right' || key === 'left') {
    return `\x1b${applicationCursor ? 'O' : '['}${ARROW_LETTER[key]}`;
  }
  return FIXED[key];
}
