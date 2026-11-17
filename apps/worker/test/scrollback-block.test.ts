import { describe, expect, it } from 'vitest';
import { ScrollbackBlock, blockTakesLine } from '../src/activities/run.activities.impl';

describe('ScrollbackBlock', () => {
  it('keeps every line while under the limit, and is not truncated', () => {
    const b = new ScrollbackBlock(3, 100);
    b.push('one');
    b.push('two');
    expect(b.text()).toBe('one\ntwo');
    expect(b.truncated).toBe(false);
    expect(b.begin).toBe(3);
  });

  it('text() stops at the last end marker', () => {
    const b = new ScrollbackBlock(1, 100);
    b.push('a');
    b.markEnd();
    expect(b.closed).toBe(true);
    b.push('b');
    b.markEnd();
    b.push('after the last marker');
    expect(b.text()).toBe('a\nb');
  });

  it('keeps only the newest lines within the limit and marks the block truncated', () => {
    const b = new ScrollbackBlock(1, 10);
    b.push('aaaa');
    b.push('bbbb');
    b.push('cccc');
    expect(b.truncated).toBe(true);
    expect(b.text()).toBe('bbbb\ncccc');
  });

  it('cuts a single over-long line to its tail', () => {
    const b = new ScrollbackBlock(1, 5);
    b.push('0123456789');
    expect(b.text()).toBe('56789');
    expect(b.truncated).toBe(true);
  });

  it('keeps the end marker aligned after older lines were dropped', () => {
    const b = new ScrollbackBlock(1, 10);
    b.push('aaaa');
    b.push('bbbb');
    b.markEnd();
    b.push('cccc');
    // 'aaaa' was dropped when 'cccc' arrived; the marker was after 'bbbb', so only 'bbbb' remains before it.
    expect(b.text()).toBe('bbbb');
  });

  it('compacts its buffer after many drops without losing the window', () => {
    const b = new ScrollbackBlock(1, 12);
    for (let i = 0; i < 3000; i += 1) b.push(`l${String(i).padStart(4, '0')}`);
    expect(b.text()).toBe('l2998\nl2999');
    expect(b.truncated).toBe(true);
  });
});

describe('blockTakesLine', () => {
  it('lets only a session end line through, and only once the block was closed by an end marker', () => {
    const b = new ScrollbackBlock(1, 100);
    expect(blockTakesLine(b, 'session_ended')).toBe(true); // still open: a pane line that looks like one
    b.push('pane');
    b.markEnd();
    expect(blockTakesLine(b, 'session_ended')).toBe(false);
    expect(blockTakesLine(b, 'text')).toBe(true);
    expect(blockTakesLine(b, 'session_started')).toBe(true);
  });
});
