const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Exact count with thousands separators: `48,213`. */
export const formatTokensExact = (n: number): string => n.toLocaleString('en-US');

/** Compact count: `999`, `2.1k`, `48.2k`, `1.2M`. A value that rounds to `1000.0k` reads `1.0M`. */
export function formatTokensCompact(n: number): string {
  if (n < 1000) return String(n);
  const k = (n / 1000).toFixed(1);
  if (Number(k) < 1000) return `${k}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Estimated cost: `—` when there is none, otherwise always starts with `~`. */
export function formatUsd(cost: number | null): string {
  if (cost === null) return '—';
  if (cost > 0 && cost < 0.01) return '~<$0.01';
  return `~$${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `D Mon YYYY` of an ISO instant in `timeZone` (the viewer's by default). */
export function formatPriceDate(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(new Date(iso));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const month = MONTHS[Number(get('month')) - 1] ?? '';
  return `${get('day')} ${month} ${get('year')}`;
}

/** One date, or `<first> to <last>`; undefined when either instant is missing. */
export function priceDateRange(earliest: string | null, latest: string | null, timeZone?: string): string | undefined {
  if (earliest === null || latest === null) return undefined;
  const first = formatPriceDate(earliest, timeZone);
  const last = formatPriceDate(latest, timeZone);
  return first === last ? first : `${first} to ${last}`;
}
