// Plain query-string search params. TanStack's default JSON-encodes values, so a number-like string such as a
// ticket number becomes `?ticket=%2212%22`, and its parser turns `?ticket=12` into the number 12. Every search
// param in this app is a string validated by the route's Zod `validateSearch`, so the URL holds plain text and
// the parsed search holds strings.

/** `?a=1&b=x` → `{ a: '1', b: 'x' }` (first value wins for a repeated key). */
export function parseSearch(searchStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(searchStr)) if (!(key in out)) out[key] = value;
  return out;
}

const toText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
};

/** `{ a: '1', b: undefined }` → `?a=1`; an empty search is ''. */
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    const text = toText(value);
    if (text !== undefined) params.set(key, text);
  }
  const str = params.toString();
  return str ? `?${str}` : '';
}
