/** Whitespace, control characters (C0, DEL) and backslashes. */
function hasUnsafeChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || ch === '\\' || /\s/.test(ch)) return true;
  }
  return false;
}

/**
 * The `redirect` search param and the sign-in callback URL accept same-origin relative paths only: one leading `/`,
 * not `//` or `/\` (protocol-relative in browsers), no scheme, no whitespace, control characters or backslashes
 * (browsers strip tabs and newlines, which would turn `/\t/host` into `//host`). Anything else is dropped.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || hasUnsafeChar(value)) return undefined;
  return value;
}
