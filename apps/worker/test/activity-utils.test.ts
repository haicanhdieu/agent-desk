import { describe, expect, it } from 'vitest';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { ERROR_MESSAGE_MAX, oneLine, safeError, secretValues, sleep } from '../src/activities/activity-utils';

describe('safeError', () => {
  it('keeps an ApplicationFailure or CancelledFailure as is', () => {
    const app = ApplicationFailure.nonRetryable('ours');
    const cancelled = new CancelledFailure('cancelled');
    expect(safeError(app, [], 'x')).toBe(app);
    expect(safeError(cancelled, [], 'x')).toBe(cancelled);
  });

  it('wraps a foreign error with a redacted, one-line, bounded message', () => {
    const secret = 'hunter2hunter2';
    const err = safeError(new TypeError(`token ${secret}\nleaked ${'a'.repeat(1000)}`), [secret], 'do it');
    expect(err).toBeInstanceOf(ApplicationFailure);
    expect(err.message.startsWith('do it: token ')).toBe(true);
    expect(err.message).not.toContain(secret);
    expect(err.message).not.toContain('\n');
    expect(err.message.length).toBeLessThanOrEqual('do it: '.length + ERROR_MESSAGE_MAX);
    expect(err).toMatchObject({ type: 'TypeError', nonRetryable: false });
  });

  it('stringifies a thrown non-Error', () => {
    const err = safeError('plain string', [], 'do it');
    expect(err).toMatchObject({ message: 'do it: plain string', type: 'Error' });
  });
});

describe('secretValues', () => {
  it('adds the URL credentials, drops short values and de-duplicates', () => {
    const url = 'https://bot:s3cr%40tpass@example.test/repo.git';
    const out = secretValues({ url, same: url, short: 'abc' });
    expect(out).toContain(url);
    expect(out).toContain('s3cr@tpass');
    expect(out).toContain('s3cr%40tpass');
    expect(out).not.toContain('abc');
    expect(new Set(out).size).toBe(out.length);
  });

  it('accepts a missing map', () => {
    expect(secretValues(null)).toEqual([]);
    expect(secretValues(undefined)).toEqual([]);
  });
});

describe('sleep', () => {
  it('resolves at once when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(sleep(60_000, ac.signal)).resolves.toBeUndefined();
  });

  it('resolves early when the signal aborts while waiting', async () => {
    const ac = new AbortController();
    const p = sleep(60_000, ac.signal);
    ac.abort();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('oneLine', () => {
  it('collapses line breaks and trims', () => {
    expect(oneLine('  a\r\nb c  ')).toBe('a b c');
  });
});
