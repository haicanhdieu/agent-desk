import { describe, expect, it } from 'vitest';
import { formatPriceDate, formatTokensCompact, formatTokensExact, formatUsd, priceDateRange } from './usageFormat';

describe('formatTokensExact', () => {
  it.each([
    [0, '0'],
    [48213, '48,213'],
    [1234567, '1,234,567'],
  ])('%i -> %s', (n, text) => {
    expect(formatTokensExact(n)).toBe(text);
  });
});

describe('formatTokensCompact', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [2104, '2.1k'],
    [48213, '48.2k'],
    [999949, '999.9k'],
    [999950, '1.0M'],
    [1234567, '1.2M'],
  ])('%i -> %s', (n, text) => {
    expect(formatTokensCompact(n)).toBe(text);
  });
});

describe('formatUsd', () => {
  it.each([
    [null, '—'],
    [0, '~$0.00'],
    [0.004, '~<$0.01'],
    [0.01, '~$0.01'],
    [0.42, '~$0.42'],
    [12.3, '~$12.30'],
    [1234.5, '~$1,234.50'],
  ])('%s -> %s', (cost, text) => {
    expect(formatUsd(cost)).toBe(text);
  });
});

describe('formatPriceDate', () => {
  it('formats D Mon YYYY', () => {
    expect(formatPriceDate('2026-09-01T12:00:00Z', 'UTC')).toBe('1 Sep 2026');
  });

  it.each([
    ['UTC', '21 Nov 2026'],
    ['America/Los_Angeles', '20 Nov 2026'],
    ['Asia/Ho_Chi_Minh', '21 Nov 2026'],
  ])('uses the local day in %s', (zone, text) => {
    expect(formatPriceDate('2026-11-21T03:30:00Z', zone)).toBe(text);
  });

  it('defaults to the viewer time zone', () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatPriceDate('2026-11-21T03:30:00Z')).toBe(formatPriceDate('2026-11-21T03:30:00Z', zone));
  });
});

describe('priceDateRange', () => {
  it('is undefined when either date is missing', () => {
    expect(priceDateRange(null, '2026-11-21T12:00:00Z')).toBeUndefined();
    expect(priceDateRange('2026-11-21T12:00:00Z', null)).toBeUndefined();
  });

  it('gives one date when both fall on the same local day', () => {
    expect(priceDateRange('2026-11-21T01:00:00Z', '2026-11-21T22:00:00Z', 'UTC')).toBe('21 Nov 2026');
  });

  it('gives a range when the local days differ', () => {
    expect(priceDateRange('2026-11-18T12:00:00Z', '2026-11-21T12:00:00Z', 'UTC')).toBe('18 Nov 2026 to 21 Nov 2026');
  });
});
