const ESC = 0x1b;
const BEL = 0x07;
const CSI_8BIT = 0x9b;

/** Index after a CSI body that starts at `i` (parameter bytes, intermediate bytes, then one final byte). */
function skipCsi(bytes: Uint8Array, start: number): number {
  let i = start;
  while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x3f) i += 1;
  while (i < bytes.length && bytes[i]! >= 0x20 && bytes[i]! <= 0x2f) i += 1;
  return i < bytes.length ? i + 1 : i;
}

/** Index after an OSC or DCS string that starts at `start`; an unterminated one consumes the rest of the chunk. */
function skipString(bytes: Uint8Array, start: number): number {
  for (let i = start; i < bytes.length; i += 1) {
    if (bytes[i] === BEL) return i + 1;
    if (bytes[i] === ESC && bytes[i + 1] === 0x5c) return i + 2;
  }
  return bytes.length;
}

/** True when the input still has bytes after CSI (7-bit and 8-bit 0x9B), OSC and DCS (up to BEL or ST), SS3, and
 *  bracketed-paste markers are removed; an X10 mouse report (ESC [ M + 3 bytes) is removed whole. */
export function isPersonTyping(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i]!;
    if (c === CSI_8BIT) {
      i = skipCsi(bytes, i + 1);
      continue;
    }
    if (c !== ESC) return true;
    const next = bytes[i + 1];
    if (next === undefined) return true; // Esc alone
    if (next === 0x5b) {
      // ESC [ : an X10 mouse report is `M` plus three bytes; any other CSI (focus, CPR, DA, SGR mouse, keys, paste markers).
      i = bytes[i + 2] === 0x4d ? Math.min(i + 6, bytes.length) : skipCsi(bytes, i + 2);
    } else if (next === 0x5d || next === 0x50) {
      i = skipString(bytes, i + 2);
    } else if (next === 0x4f) {
      i = Math.min(i + 3, bytes.length); // SS3: ESC O + one byte
    } else {
      return true; // Alt-key
    }
  }
  return false;
}
