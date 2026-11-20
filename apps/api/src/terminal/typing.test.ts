import { describe, expect, it } from 'vitest';
import { isPersonTyping } from './typing';

const b = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('isPersonTyping', () => {
  it.each([
    ['a letter', 'a'],
    ['Enter', '\r'],
    ['Backspace', '\x7f'],
    ['Ctrl-C', '\x03'],
    ['Esc alone', '\x1b'],
    ['Alt-x', '\x1bx'],
    ['a bracketed paste', '\x1b[200~pasted text\x1b[201~'],
    ['an arrow key followed by text', '\x1b[Ahello'],
  ])('is true for %s', (_name, input) => {
    expect(isPersonTyping(b(input))).toBe(true);
  });

  it.each([
    ['a cursor position report', '\x1b[12;40R'],
    ['a device attributes reply', '\x1b[?1;2c'],
    ['an OSC colour reply ended by ST', '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\'],
    ['an OSC colour reply ended by BEL', '\x1b]10;rgb:ffff/ffff/ffff\x07'],
    ['a DCS reply', '\x1bP1$r0m\x1b\\'],
    ['focus in', '\x1b[I'],
    ['focus out', '\x1b[O'],
    ['an SGR mouse report', '\x1b[<0;10;5M'],
    ['an X10 mouse report', '\x1b[M !!'],
    ['an SS3 key', '\x1bOA'],
    ['two arrow keys', '\x1b[A\x1b[B'],
    ['an unterminated OSC', '\x1b]11;rgb:1e1e'],
  ])('is false for %s', (_name, input) => {
    expect(isPersonTyping(b(input))).toBe(false);
  });

  it('is false for an 8-bit CSI sequence', () => {
    expect(isPersonTyping(Uint8Array.of(0x9b, 0x41))).toBe(false);
  });

  it('is false for an empty array', () => {
    expect(isPersonTyping(new Uint8Array())).toBe(false);
  });

  it('is true for text after an X10 mouse report', () => {
    expect(isPersonTyping(b('\x1b[M !!x'))).toBe(true);
  });
});
