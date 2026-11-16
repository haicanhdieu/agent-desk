// Terminal attach state as a set of leases that expire, instead of a counter that leaks when the API dies without a
// detach. Pure and immutable: every function returns a new map. Workflow code cannot import @agentdesk/core (it pulls
// in node-only modules), so the timing values mirror core's TERMINAL_LEASE_* constants and a test asserts equality.

/** id -> expiry, in workflow milliseconds. */
export type Leases = ReadonlyMap<string, number>;

/** The API sends its live ids this often (mirrors TERMINAL_LEASE_INTERVAL_SECONDS in core). */
export const LEASE_INTERVAL_MS = 120_000;
/** An id unheard for this long is dropped (mirrors TERMINAL_LEASE_TTL_SECONDS in core). */
export const LEASE_TTL_MS = 300_000;
/** Most ids one run's set holds, and most ids one lease signal is read for (the API allows 4 sockets per run). */
export const MAX_LEASE_IDS = 16;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A connection id is the API's own UUID; anything else (client text, a wrong type) is ignored. */
export const isLeaseId = (id: unknown): id is string => typeof id === 'string' && UUID.test(id);

/** Starts (or restarts) a lease. A malformed id, or a new id beyond the cap, changes nothing. */
export function attach(l: Leases, id: string, nowMs: number, ttlMs: number = LEASE_TTL_MS): Leases {
  if (!isLeaseId(id)) return l;
  if (!l.has(id) && l.size >= MAX_LEASE_IDS) return l;
  return new Map(l).set(id, nowMs + ttlMs);
}

/** Ends a lease. An id that is not there (detach before attach, a second detach) changes nothing. */
export function detach(l: Leases, id: string): Leases {
  if (!l.has(id)) return l;
  const next = new Map(l);
  next.delete(id);
  return next;
}

/** Extends the leases of the ids the API says are open. Unknown and malformed ids are ignored, as are ids past the cap. */
export function renew(l: Leases, ids: readonly string[], nowMs: number, ttlMs: number = LEASE_TTL_MS): Leases {
  let next: Map<string, number> | undefined;
  for (const id of ids.slice(0, MAX_LEASE_IDS)) {
    if (!isLeaseId(id) || !l.has(id)) continue;
    next ??= new Map(l);
    next.set(id, nowMs + ttlMs);
  }
  return next ?? l;
}

/** Drops every lease whose expiry has passed. */
export function expire(l: Leases, nowMs: number): Leases {
  let next: Map<string, number> | undefined;
  for (const [id, at] of l) {
    if (at > nowMs) continue;
    next ??= new Map(l);
    next.delete(id);
  }
  return next ?? l;
}

/** When the earliest lease runs out, or undefined with none. */
export function nextExpiryMs(l: Leases): number | undefined {
  let earliest: number | undefined;
  for (const at of l.values()) if (earliest === undefined || at < earliest) earliest = at;
  return earliest;
}

export const count = (l: Leases): number => l.size;
