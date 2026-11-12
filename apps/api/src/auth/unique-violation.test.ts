import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './auth';

describe('isUniqueViolation', () => {
  it('detects pg errors directly and wrapped in a cause (DrizzleQueryError)', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('wrapped', { cause: { code: '23505' } }))).toBe(true);
    expect(isUniqueViolation(new Error('x', { cause: { code: '23503' } }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
