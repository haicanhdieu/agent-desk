import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_UNUSED_CLOSE_MS, watchUnused } from './unusedWatch';

const HOUR = 60 * 60 * 1000;
let visibility: DocumentVisibilityState;

const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TERMINAL_UNUSED_CLOSE_MS', () => {
  it('is 4 hours, one named constant', () => {
    expect(TERMINAL_UNUSED_CLOSE_MS).toBe(4 * HOUR);
  });
});

describe('watchUnused', () => {
  it('fires once when nothing was used for the whole time', () => {
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    vi.advanceTimersByTime(TERMINAL_UNUSED_CLOSE_MS - 1);
    expect(onUnused).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onUnused).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TERMINAL_UNUSED_CLOSE_MS * 3);
    expect(onUnused).toHaveBeenCalledTimes(1);
  });

  it.each(['keydown', 'pointerdown', 'wheel', 'touchstart'])('a %s postpones it by the full time', (type) => {
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    vi.advanceTimersByTime(3 * HOUR);
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
    vi.advanceTimersByTime(3 * HOUR);
    expect(onUnused).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR);
    expect(onUnused).toHaveBeenCalledTimes(1);
  });

  it.each(['mousemove', 'pointermove', 'focus', 'scroll', 'click', 'keyup'])('a %s is not use', (type) => {
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    vi.advanceTimersByTime(3 * HOUR);
    document.body.dispatchEvent(new Event(type, { bubbles: true }));
    vi.advanceTimersByTime(HOUR);
    expect(onUnused).toHaveBeenCalledTimes(1);
  });

  it('a tab hidden the whole time fires even when something keeps sending use events to the hidden page', () => {
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    setVisibility('hidden');
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(HOUR + 10 * 60 * 1000);
      document.body.dispatchEvent(new Event('keydown', { bubbles: true }));
    }
    // 3 h 30 min so far: the keydowns kept the idle rule off, the hidden rule has 30 minutes left.
    expect(onUnused).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(onUnused).toHaveBeenCalledTimes(1);
  });

  it('showing the tab again restarts the hidden time', () => {
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    setVisibility('hidden');
    vi.advanceTimersByTime(3 * HOUR);
    setVisibility('visible');
    document.body.dispatchEvent(new Event('keydown', { bubbles: true }));
    setVisibility('hidden');
    vi.advanceTimersByTime(3 * HOUR);
    expect(onUnused).not.toHaveBeenCalled();
    vi.advanceTimersByTime(HOUR);
    expect(onUnused).toHaveBeenCalledTimes(1);
  });

  it('a tab hidden in pieces, with use between, never fires', () => {
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    for (let i = 0; i < 6; i++) {
      setVisibility('hidden');
      vi.advanceTimersByTime(3 * HOUR);
      setVisibility('visible');
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    }
    expect(onUnused).not.toHaveBeenCalled();
  });

  it('a page that starts hidden counts from the start', () => {
    visibility = 'hidden';
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    vi.advanceTimersByTime(TERMINAL_UNUSED_CLOSE_MS);
    expect(onUnused).toHaveBeenCalledTimes(1);
  });

  it('fires late when the timer was throttled (a sleeping laptop): the clock decides, not the timer count', () => {
    const onUnused = vi.fn();
    watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    vi.setSystemTime(Date.now() + 9 * HOUR);
    vi.advanceTimersByTime(TERMINAL_UNUSED_CLOSE_MS);
    expect(onUnused).toHaveBeenCalledTimes(1);
  });

  it('dispose stops it and removes the listeners', () => {
    const onUnused = vi.fn();
    const stop = watchUnused(TERMINAL_UNUSED_CLOSE_MS, onUnused);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(TERMINAL_UNUSED_CLOSE_MS * 2);
    expect(onUnused).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event('keydown', { bubbles: true }));
    setVisibility('hidden');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a second call after dispose does nothing', () => {
    const stop = watchUnused(1000, vi.fn());
    stop();
    expect(() => stop()).not.toThrow();
  });
});
