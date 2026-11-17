import { describe, expect, it } from 'vitest';
import { TERMINAL_LEASE_INTERVAL_SECONDS, TERMINAL_LEASE_TTL_SECONDS } from '@agentdesk/core';
import {
  LEASE_INTERVAL_MS,
  LEASE_TTL_MS,
  MAX_LEASE_IDS,
  attach,
  count,
  detach,
  expire,
  isLeaseId,
  nextExpiryMs,
  renew,
  type Leases,
} from '../src/workflows/attach-leases';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const NONE: Leases = new Map();

describe('attach leases (pure)', () => {
  it('mirrors the shared lease timing in core', () => {
    expect(LEASE_INTERVAL_MS).toBe(TERMINAL_LEASE_INTERVAL_SECONDS * 1000);
    expect(LEASE_TTL_MS).toBe(TERMINAL_LEASE_TTL_SECONDS * 1000);
    expect([LEASE_INTERVAL_MS, LEASE_TTL_MS]).toEqual([120_000, 300_000]);
  });

  it('attach counts one lease per id; a second attach with the same id does not count twice', () => {
    const l = attach(attach(NONE, A, 0), A, 10);
    expect(count(l)).toBe(1);
    expect(count(attach(l, B, 10))).toBe(2);
  });

  it('detach before attach leaves the count at 0, and a double detach does too', () => {
    expect(count(detach(NONE, A))).toBe(0);
    const l = attach(NONE, A, 0);
    const once = detach(l, A);
    expect(count(once)).toBe(0);
    expect(count(detach(once, A))).toBe(0);
  });

  it('detach removes only its own id', () => {
    const l = detach(attach(attach(NONE, A, 0), B, 0), A);
    expect(count(l)).toBe(1);
    expect([...l.keys()]).toEqual([B]);
  });

  it('renew of an unknown id changes nothing', () => {
    const l = attach(NONE, A, 0);
    const renewed = renew(l, [B], 1000);
    expect(count(renewed)).toBe(1);
    expect([...renewed.keys()]).toEqual([A]);
    expect(count(renew(NONE, [A], 0))).toBe(0);
  });

  it('an id unheard for the TTL expires; a renewed one does not', () => {
    let l = attach(attach(NONE, A, 0), B, 0);
    l = renew(l, [B], 200_000);
    expect(count(expire(l, LEASE_TTL_MS - 1))).toBe(2);
    const later = expire(l, LEASE_TTL_MS);
    expect([...later.keys()]).toEqual([B]);
    expect(count(expire(later, 200_000 + LEASE_TTL_MS))).toBe(0);
  });

  it('nextExpiryMs is the earliest expiry, or undefined with no leases', () => {
    expect(nextExpiryMs(NONE)).toBeUndefined();
    const l = renew(attach(attach(NONE, A, 1000), B, 5000), [A], 9000);
    expect(nextExpiryMs(l)).toBe(5000 + LEASE_TTL_MS);
  });

  it('the TTL is a parameter (a test seam)', () => {
    const l = attach(NONE, A, 0, 1000);
    expect(nextExpiryMs(l)).toBe(1000);
    expect(count(expire(l, 1000))).toBe(0);
    expect(nextExpiryMs(renew(l, [A], 500, 1000))).toBe(1500);
  });

  it('never changes the map it was given', () => {
    const l = attach(NONE, A, 0);
    attach(l, B, 0);
    renew(l, [A], 9);
    detach(l, A);
    expire(l, 10 ** 9);
    expect([...l.entries()]).toEqual([[A, LEASE_TTL_MS]]);
  });

  describe('malformed input', () => {
    it('isLeaseId accepts only a uuid string', () => {
      expect(isLeaseId(A)).toBe(true);
      for (const bad of ['', 'abc', `${A}x`, '../../etc', 'a;b', 42, null, undefined, {}, [A]]) {
        expect(isLeaseId(bad)).toBe(false);
      }
    });

    it('a malformed id is ignored by attach, renew and detach', () => {
      expect(count(attach(NONE, 'not-an-id', 0))).toBe(0);
      expect(count(renew(attach(NONE, A, 0), ['not-an-id', 7 as unknown as string], 5))).toBe(1);
      expect(count(detach(attach(NONE, A, 0), 'not-an-id'))).toBe(1);
    });
  });

  describe('caps', () => {
    const ids = Array.from(
      { length: MAX_LEASE_IDS + 5 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );

    it('the set never holds more than MAX_LEASE_IDS ids; an existing id can still be renewed at the cap', () => {
      let l: Leases = NONE;
      for (const id of ids) l = attach(l, id, 0);
      expect(count(l)).toBe(MAX_LEASE_IDS);
      const first = ids[0] ?? A;
      expect(nextExpiryMs(renew(l, [first], 1000))).toBe(LEASE_TTL_MS);
      expect(count(renew(l, ids, 1000))).toBe(MAX_LEASE_IDS);
    });

    it('renew looks at no more than MAX_LEASE_IDS ids of one signal', () => {
      const first = ids[0] ?? A;
      let l: Leases = NONE;
      for (const id of ids.slice(0, MAX_LEASE_IDS)) l = attach(l, id, 0);
      // Unknown ids fill the allowed slots, so the known id sits one past the cap.
      const signal = [...Array.from({ length: MAX_LEASE_IDS }, () => B), first];
      expect(renew(l, signal, 9000).get(first)).toBe(LEASE_TTL_MS);
      expect(renew(l, [first], 9000).get(first)).toBe(9000 + LEASE_TTL_MS);
    });
  });
});
