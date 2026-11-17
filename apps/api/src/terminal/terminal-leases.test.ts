import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalLeases } from './terminal-leases';

const INTERVAL = 120_000;

describe('TerminalLeases', () => {
  let sent: Array<{ key: string; ids: string[] }>;
  let leases: TerminalLeases;
  const sender = (key: string) => (ids: string[]) => void sent.push({ key, ids });

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    leases = new TerminalLeases(() => INTERVAL);
  });
  afterEach(() => {
    leases.stop();
    vi.useRealTimers();
  });

  it('sends nothing before the first interval, then the live ids once per interval', () => {
    leases.track('run:r1', 'a', sender('run:r1'));
    leases.track('run:r1', 'b', sender('run:r1'));
    vi.advanceTimersByTime(INTERVAL - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ key: 'run:r1', ids: ['a', 'b'] }]);
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toHaveLength(2);
  });

  it('a closed id leaves the next signal; the last close stops the timer', () => {
    leases.track('run:r1', 'a', sender('run:r1'));
    leases.track('run:r1', 'b', sender('run:r1'));
    leases.untrack('run:r1', 'a');
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual([{ key: 'run:r1', ids: ['b'] }]);
    leases.untrack('run:r1', 'b');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(INTERVAL * 5);
    expect(sent).toHaveLength(1);
    expect(leases.runCount()).toBe(0);
  });

  it('keeps one timer per run, and runs are independent', () => {
    leases.track('run:r1', 'a', sender('run:r1'));
    leases.track('run:r1', 'b', sender('run:r1'));
    leases.track('run:r2', 'c', sender('run:r2'));
    expect(vi.getTimerCount()).toBe(2);
    leases.untrack('run:r1', 'a');
    leases.untrack('run:r1', 'b');
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual([{ key: 'run:r2', ids: ['c'] }]);
  });

  it('tracking the same id twice, or untracking an unknown id, changes nothing', () => {
    leases.track('run:r1', 'a', sender('run:r1'));
    leases.track('run:r1', 'a', sender('run:r1'));
    leases.untrack('run:r1', 'zzz');
    leases.untrack('run:other', 'a');
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual([{ key: 'run:r1', ids: ['a'] }]);
  });

  it('starts again after the last id left and a new one arrives', () => {
    leases.track('run:r1', 'a', sender('run:r1'));
    leases.untrack('run:r1', 'a');
    leases.track('run:r1', 'b', sender('run:r1'));
    vi.advanceTimersByTime(INTERVAL);
    expect(sent).toEqual([{ key: 'run:r1', ids: ['b'] }]);
  });

  it('stop clears every timer', () => {
    leases.track('run:r1', 'a', sender('run:r1'));
    leases.track('run:r2', 'b', sender('run:r2'));
    leases.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(INTERVAL * 2);
    expect(sent).toEqual([]);
  });

  it('reads the interval when a run starts, so a test can change it', () => {
    let ms = 1000;
    const l = new TerminalLeases(() => ms);
    l.track('run:r1', 'a', sender('run:r1'));
    ms = 99_999;
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
    l.stop();
  });
});
