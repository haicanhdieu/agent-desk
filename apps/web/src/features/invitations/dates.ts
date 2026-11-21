// The invitee's dates: "23 Nov, 14:05" in the cards, "23 Nov 2026, 14:05" on hover. `timeZone` is optional so tests
// can pin it; the browser's zone applies otherwise.

function parts(iso: string, withYear: boolean, timeZone: string | undefined): Record<string, string> {
  const format = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear && { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone !== undefined && { timeZone }),
  });
  return Object.fromEntries(format.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

export function formatShortDate(iso: string, timeZone?: string): string {
  const p = parts(iso, false, timeZone);
  return `${p.day} ${p.month}, ${p.hour}:${p.minute}`;
}

export function formatFullDate(iso: string, timeZone?: string): string {
  const p = parts(iso, true, timeZone);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}
