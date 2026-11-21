import type { PrState } from '@agentdesk/contracts';
import type { Clock } from '@agentdesk/core';

export interface PrStateLookupOptions {
  clock: Clock;
  ttlMs: number;
  timeoutMs: number;
  maxEntries: number;
}

/** Injection token for the PR state lookup options (clock, TTL, timeout, cache size). */
export const PR_STATE_LOOKUP = Symbol('PR_STATE_LOOKUP');

export const PR_STATE_LOOKUP_DEFAULTS: Omit<PrStateLookupOptions, 'clock'> = {
  ttlMs: 60_000,
  timeoutMs: 5_000,
  maxEntries: 10_000,
};

/** Marks a ref the provider answered for without a PR state (not found, not a PR, unknown state). */
export const UNRESOLVED = 'unresolved';

interface Entry {
  state: PrState | typeof UNRESOLVED;
  storedAt: number;
}

/** A per-project, per-PR TTL cache of live PR states. Holds only PrState values or the unresolved marker, never provider text. */
export class PrStateCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly clock: Clock,
    private readonly opts: { ttlMs: number; maxEntries: number },
  ) {}

  /** undefined when absent or expired (now - storedAt >= ttlMs); UNRESOLVED when the provider left the ref out. */
  get(projectId: string, ref: string): PrState | typeof UNRESOLVED | undefined {
    const key = `${projectId}:${ref}`;
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (this.clock.now().getTime() - hit.storedAt >= this.opts.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.state;
  }

  /** Re-setting moves the entry to newest; above maxEntries the oldest is dropped. */
  set(projectId: string, ref: string, state: PrState | typeof UNRESOLVED): void {
    const key = `${projectId}:${ref}`;
    this.entries.delete(key);
    this.entries.set(key, { state, storedAt: this.clock.now().getTime() });
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
