/** The pg unique_violation error in `err`'s cause chain (drizzle wraps the driver error), else null. */
function findUniqueViolation(err: unknown): object | null {
  for (let e: unknown = err, depth = 0; typeof e === 'object' && e !== null && depth < 4; depth += 1) {
    if ('code' in e && e.code === '23505') return e;
    e = 'cause' in e ? e.cause : undefined;
  }
  return null;
}

/** True when `err` (or its cause, as wrapped by drizzle) is a Postgres unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return findUniqueViolation(err) !== null;
}

/** Error name and pg code (from the error or its drizzle-wrapped cause) only: messages can echo row values. */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown';
  const cause = err.cause;
  const own = 'code' in err ? err.code : undefined;
  const wrapped = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
  const code = own ?? wrapped;
  return code !== undefined ? `${err.name} (${String(code)})` : err.name;
}

/** The violated constraint's name for a unique_violation (from the error or its drizzle-wrapped cause), else null. */
export function uniqueViolationConstraint(err: unknown): string | null {
  const e = findUniqueViolation(err);
  if (e === null) return null;
  return 'constraint' in e && typeof e.constraint === 'string' ? e.constraint : '';
}
