import type { LogLineKind, ParsedLogLine } from './log-parser';

export type SetupLogEffect =
  | {
      kind: 'event';
      payload: { kind: LogLineKind; text: string; pluginId?: string; exitCode?: number; sha?: string };
    }
  | { kind: 'output'; payload: { kind: 'setup_output' | 'plugin_output'; text: string; truncated: boolean } };

export interface SetupSummary {
  checkoutSha: string | null;
  plugins: { installed: string[]; skipped: string[]; failed: string[] };
  setup: 'pending' | 'skipped' | 'passed' | 'failed' | 'timed_out';
  exitCode: number | null;
}

/** Marker kinds of the workspace preparation phase; each becomes an `event` effect. */
const EVENT_KINDS: ReadonlySet<LogLineKind> = new Set<LogLineKind>([
  'checkout',
  'plugins_begin',
  'plugin_installed',
  'plugin_skipped',
  'plugin_failed',
  'plugins_end',
  'setup_begin',
  'setup_skipped',
  'setup_passed',
  'setup_failed',
  'setup_timed_out',
]);

/**
 * Pure state machine over the runner's setup/plugin log lines (no I/O, independent of runs). Output lines are batched
 * into chunks of `chunkLines`; any other line flushes the buffer first, so a chunk is always followed by the marker
 * that ended it. A single `push` returns at most one `output` effect. Once `maxChars` of output is reached, one chunk
 * with `truncated: true` is produced and later output is dropped.
 */
export class SetupLogTracker {
  private buffer: string[] = [];
  private bufferKind: 'setup_output' | 'plugin_output' = 'setup_output';
  private chars: number;
  private truncated: boolean;
  private readonly state: SetupSummary = {
    checkoutSha: null,
    plugins: { installed: [], skipped: [], failed: [] },
    setup: 'pending',
    exitCode: null,
  };

  /**
   * `initialChars` and `alreadyTruncated` seed the output budget from earlier passes (the caller derives them from
   * storage), so the cap and the single truncated chunk hold across log re-attaches and retries.
   */
  constructor(
    private readonly opts: { chunkLines: number; maxChars: number; initialChars?: number; alreadyTruncated?: boolean },
  ) {
    this.chars = opts.initialChars ?? 0;
    this.truncated = opts.alreadyTruncated ?? false;
  }

  get summary(): SetupSummary {
    return {
      ...this.state,
      plugins: {
        installed: [...this.state.plugins.installed],
        skipped: [...this.state.plugins.skipped],
        failed: [...this.state.plugins.failed],
      },
    };
  }

  /** Output lines buffered and not yet emitted. */
  get pendingLines(): number {
    return this.buffer.length;
  }

  push(p: ParsedLogLine): SetupLogEffect[] {
    if (p.kind === 'setup_output' || p.kind === 'plugin_output') return this.pushOutput(p.kind, p.text);
    const effects = this.flush();
    if (EVENT_KINDS.has(p.kind)) {
      this.track(p);
      effects.push({
        kind: 'event',
        payload: {
          kind: p.kind,
          text: p.text,
          ...(p.pluginId !== undefined ? { pluginId: p.pluginId } : {}),
          ...(p.exitCode !== undefined ? { exitCode: p.exitCode } : {}),
          ...(p.sha !== undefined ? { sha: p.sha } : {}),
        },
      });
    }
    return effects;
  }

  flush(): SetupLogEffect[] {
    if (this.buffer.length === 0) return [];
    const text = this.buffer.join('\n');
    this.buffer = [];
    return [{ kind: 'output', payload: { kind: this.bufferKind, text, truncated: false } }];
  }

  private pushOutput(kind: 'setup_output' | 'plugin_output', text: string): SetupLogEffect[] {
    if (this.truncated) return [];
    if (this.buffer.length > 0 && this.bufferKind !== kind) {
      if (text.length > this.opts.maxChars - this.chars) {
        // Budget exhausted on a kind change: the buffered chunk (whole) is the last one and the new line is dropped, so
        // this push still returns exactly one output effect and never mixes kinds.
        this.truncated = true;
        const last: SetupLogEffect = {
          kind: 'output',
          payload: { kind: this.bufferKind, text: this.buffer.join('\n'), truncated: true },
        };
        this.buffer = [];
        return [last];
      }
      const flushed = this.flush();
      this.bufferKind = kind;
      this.chars += text.length;
      this.buffer.push(text);
      // The new line starts a fresh buffer and stays there (even at chunkLines 1) so this push returns one effect.
      return flushed;
    }
    const effects: SetupLogEffect[] = [];
    this.bufferKind = kind;
    const join = this.buffer.length > 0 ? 1 : 0;
    const room = this.opts.maxChars - this.chars - join;
    if (text.length > room) {
      // Budget exhausted: the chunk so far plus what fits of this line is the last one (at most one output effect).
      this.truncated = true;
      const kept = [...this.buffer, ...(room > 0 ? [text.slice(0, room)] : [])];
      this.buffer = [];
      return [{ kind: 'output', payload: { kind, text: kept.join('\n'), truncated: true } }];
    }
    this.chars += text.length + join;
    this.buffer.push(text);
    if (this.buffer.length >= this.opts.chunkLines) effects.push(...this.flush());
    return effects;
  }

  private track(p: ParsedLogLine): void {
    const s = this.state;
    if (p.kind === 'checkout') s.checkoutSha = p.sha ?? null;
    else if (p.kind === 'plugin_installed' && p.pluginId) s.plugins.installed.push(p.pluginId);
    else if (p.kind === 'plugin_skipped' && p.pluginId) s.plugins.skipped.push(p.pluginId);
    else if (p.kind === 'plugin_failed' && p.pluginId) s.plugins.failed.push(p.pluginId);
    // The last result marker wins (a process writing to the container log directly can print an earlier one), so each
    // result also resets the exit code.
    else if (p.kind === 'setup_skipped' || p.kind === 'setup_passed' || p.kind === 'setup_timed_out') {
      s.setup = p.kind === 'setup_skipped' ? 'skipped' : p.kind === 'setup_passed' ? 'passed' : 'timed_out';
      s.exitCode = null;
    } else if (p.kind === 'setup_failed') {
      s.setup = 'failed';
      s.exitCode = p.exitCode ?? null;
    }
  }
}
