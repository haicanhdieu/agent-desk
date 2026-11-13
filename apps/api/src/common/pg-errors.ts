/** True when `err` (or its cause, as wrapped by drizzle) is a Postgres unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; typeof e === 'object' && e !== null && depth < 4; depth += 1) {
    if ('code' in e && e.code === '23505') return true;
    e = 'cause' in e ? e.cause : undefined;
  }
  return false;
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
