import { describe, expect, it } from 'vitest';
import { parseLogLine } from '../../src/kube/log-parser';
import { SetupLogTracker, type SetupLogEffect } from '../../src/kube/setup-log';

const SHA = 'b'.repeat(40);
const feed = (t: SetupLogTracker, lines: string[]): SetupLogEffect[] => lines.flatMap((l) => t.push(parseLogLine(l)));
const tracker = (chunkLines = 50, maxChars = 262144) => new SetupLogTracker({ chunkLines, maxChars });

describe('SetupLogTracker', () => {
  it('batches output into chunks of chunkLines and keeps the remainder until flush', () => {
    const t = tracker(50);
    const lines = Array.from({ length: 120 }, (_, i) => `setup| line ${i}`);
    const effects = feed(t, lines);
    expect(effects).toHaveLength(2);
    expect(effects[0]).toEqual({
      kind: 'output',
      payload: {
        kind: 'setup_output',
        text: Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'),
        truncated: false,
      },
    });
    expect(t.pendingLines).toBe(20);
    const rest = t.flush();
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ kind: 'output', payload: { kind: 'setup_output', truncated: false } });
    expect(t.pendingLines).toBe(0);
    expect(t.flush()).toEqual([]);
  });

  it('flushes buffered output before a marker, then emits the marker event', () => {
    const t = tracker();
    const effects = feed(t, ['setup| a', 'setup| b', 'agentdesk: setup passed']);
    expect(effects.map((e) => e.kind)).toEqual(['output', 'event']);
    expect(effects[0]).toMatchObject({ payload: { text: 'a\nb' } });
    expect(effects[1]).toEqual({ kind: 'event', payload: { kind: 'setup_passed', text: 'agentdesk: setup passed' } });
  });

  it('keeps pluginId, sha and exitCode on events and never mixes output kinds in one chunk', () => {
    const t = tracker();
    const effects = feed(t, [
      `agentdesk: checkout ${SHA}`,
      'plugin| p1',
      'setup| s1',
      'agentdesk: plugin installed demo@acme',
      'agentdesk: setup failed exit=7',
    ]);
    expect(effects.map((e) => (e.kind === 'event' ? e.payload.kind : `out:${e.payload.kind}`))).toEqual([
      'checkout',
      'out:plugin_output',
      'out:setup_output',
      'plugin_installed',
      'setup_failed',
    ]);
    expect(effects[0]).toMatchObject({ payload: { sha: SHA } });
    expect(effects[3]).toMatchObject({ payload: { pluginId: 'demo@acme' } });
    expect(effects[4]).toMatchObject({ payload: { exitCode: 7 } });
  });

  it('emits one truncated chunk at maxChars and drops later output', () => {
    const t = tracker(50, 10);
    const effects = feed(t, ['setup| 1234567', 'setup| 89abcdef', 'setup| more', 'setup| more']);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ kind: 'output', payload: { kind: 'setup_output', truncated: true } });
    const text = effects[0]?.kind === 'output' ? effects[0].payload.text : '';
    expect(text.length).toBeLessThanOrEqual(10);
    expect(t.pendingLines).toBe(0);
    // Markers still flow; nothing more is emitted for output.
    expect(feed(t, ['setup| x', 'agentdesk: setup passed']).map((e) => e.kind)).toEqual(['event']);
    expect(t.flush()).toEqual([]);
  });

  it('summary lists plugins, checkout, setup result and exit code', () => {
    const t = tracker();
    expect(t.summary).toEqual({
      checkoutSha: null,
      plugins: { installed: [], skipped: [], failed: [] },
      setup: 'pending',
      exitCode: null,
    });
    feed(t, [
      `agentdesk: checkout ${SHA}`,
      'agentdesk: plugin installed a@x',
      'agentdesk: plugin skipped b@y (store not approved)',
      'agentdesk: plugin failed c@x',
      'agentdesk: setup begin',
      'agentdesk: setup failed exit=3',
    ]);
    expect(t.summary).toEqual({
      checkoutSha: SHA,
      plugins: { installed: ['a@x'], skipped: ['b@y'], failed: ['c@x'] },
      setup: 'failed',
      exitCode: 3,
    });
  });

  it.each([
    ['agentdesk: setup skipped (no script)', 'skipped'],
    ['agentdesk: setup passed', 'passed'],
    ['agentdesk: setup timed out', 'timed_out'],
  ])('%s sets setup to %s', (line, expected) => {
    const t = tracker();
    feed(t, [line]);
    expect(t.summary.setup).toBe(expected);
    expect(t.summary.exitCode).toBeNull();
  });

  it('other lines flush output but emit nothing themselves', () => {
    const t = tracker();
    const effects = feed(t, ['setup| a', 'agentdesk: session started', 'plain text']);
    expect(effects.map((e) => e.kind)).toEqual(['output']);
  });
});
