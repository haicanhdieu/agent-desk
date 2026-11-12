import { slugFromHandle } from './slug';

/** drizzle wraps pg errors in DrizzleQueryError with the pg error on `.cause`, so check both levels. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (v: unknown): unknown => (typeof v === 'object' && v !== null && 'code' in v ? v.code : undefined);
  const cause = typeof e === 'object' && e !== null && 'cause' in e ? e.cause : undefined;
  return code(e) === '23505' || code(cause) === '23505';
}

export const MAX_SLUG_ATTEMPTS = 5;

/**
 * Picks a free slug and runs `insert(slug)`. If the insert loses a race (unique violation), slugs already attempted
 * count as taken and the next candidate is tried, at most `maxAttempts` times; then the violation is rethrown.
 */
export async function createWithUniqueSlug<T>(opts: {
  handle: string;
  isTaken: (slug: string) => Promise<boolean>;
  insert: (slug: string) => Promise<T>;
  maxAttempts?: number;
}): Promise<T> {
  const max = opts.maxAttempts ?? MAX_SLUG_ATTEMPTS;
  const attempted = new Set<string>();
  let last: unknown;
  for (let i = 0; i < max; i += 1) {
    const slug = await slugFromHandle(opts.handle, async (s) => attempted.has(s) || opts.isTaken(s));
    attempted.add(slug);
    try {
      return await opts.insert(slug);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      last = e;
    }
  }
  throw last;
}
