/**
 * True when `err` (or its cause, as wrapped by drizzle) is a Postgres unique_violation, optionally only for the
 * named constraint.
 */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  for (let e: unknown = err, depth = 0; typeof e === 'object' && e !== null && depth < 4; depth += 1) {
    if ('code' in e && e.code === '23505') {
      return constraint === undefined || ('constraint' in e && e.constraint === constraint);
    }
    e = 'cause' in e ? e.cause : undefined;
  }
  return false;
}
