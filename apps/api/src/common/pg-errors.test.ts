import { describe, expect, it } from 'vitest';
import { isUniqueViolation, uniqueViolationConstraint } from './pg-errors';

describe('unique violation helpers', () => {
  const pg = { code: '23505', constraint: 'agents_project_name_idx' };

  it('finds the pg error directly or behind a drizzle cause', () => {
    expect(isUniqueViolation(pg)).toBe(true);
    expect(isUniqueViolation(new Error('wrapped', { cause: pg }))).toBe(true);
    expect(uniqueViolationConstraint(new Error('wrapped', { cause: pg }))).toBe('agents_project_name_idx');
  });

  it('is false and null for other errors', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation('boom')).toBe(false);
    expect(uniqueViolationConstraint({ code: '23503' })).toBeNull();
  });

  it('gives an empty constraint when the pg error carries none', () => {
    expect(uniqueViolationConstraint({ code: '23505' })).toBe('');
  });
});
