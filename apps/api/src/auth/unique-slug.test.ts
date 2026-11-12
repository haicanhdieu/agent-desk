import { describe, expect, it } from 'vitest';
import { createWithUniqueSlug, isUniqueViolation } from './unique-slug';

const collision = () => Object.assign(new Error('x'), { cause: { code: '23505' } });

describe('isUniqueViolation', () => {
  it('detects pg errors directly and wrapped in a cause (DrizzleQueryError)', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(collision())).toBe(true);
    expect(isUniqueViolation(new Error('x', { cause: { code: '23503' } }))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('createWithUniqueSlug', () => {
  it('retries with a different slug after a wrapped unique violation', async () => {
    const slugs: string[] = [];
    const result = await createWithUniqueSlug({
      handle: 'alice',
      isTaken: async () => false,
      insert: async (slug) => {
        slugs.push(slug);
        if (slugs.length === 1) throw collision();
        return slug;
      },
    });
    expect(slugs).toEqual(['alice', 'alice-2']);
    expect(result).toBe('alice-2');
  });

  it('is bounded: rethrows after maxAttempts collisions', async () => {
    let calls = 0;
    await expect(
      createWithUniqueSlug({
        handle: 'alice',
        isTaken: async () => false,
        maxAttempts: 3,
        insert: async () => {
          calls += 1;
          throw collision();
        },
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    expect(calls).toBe(3);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    await expect(
      createWithUniqueSlug({
        handle: 'a',
        isTaken: async () => false,
        insert: async () => {
          calls += 1;
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});
