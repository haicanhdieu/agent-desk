/** True when `err` (or its cause, as wrapped by drizzle) is a Postgres unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; typeof e === 'object' && e !== null && depth < 4; depth += 1) {
    if ('code' in e && e.code === '23505') return true;
    e = 'cause' in e ? e.cause : undefined;
  }
  return false;
}
