import type { InvitationStatus } from '@agentdesk/contracts';
import type { ExpiryView } from '@/mocks/types';

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

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** An invitation expired for longer than this shows its date, not "Expired n days ago". */
const RELATIVE_EXPIRED_MS = 3 * DAY_MS;

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** "5 days", "5 hours" or, within the first hour, "less than an hour". */
function span(ms: number): string {
  if (ms >= DAY_MS) return plural(Math.floor(ms / DAY_MS), 'day');
  if (ms >= HOUR_MS) return plural(Math.floor(ms / HOUR_MS), 'hour');
  return 'less than an hour';
}

/**
 * The Expires column (BR-30, BR-51). A pending invitation, or one expired up to 3 days ago, reads relative to `now`
 * with the exact date as its title; one expired longer ago shows its date; a final status shows a dash.
 */
export function expiresView(expiresAt: string, status: InvitationStatus, now: Date, timeZone?: string): ExpiryView {
  if (status !== 'pending' && status !== 'expired') return { kind: 'none', text: '–' };
  const title = formatFullDate(expiresAt, timeZone);
  const left = Date.parse(expiresAt) - now.getTime();
  if (left >= 0) {
    return { kind: 'relative', text: `Expires in ${span(left)}`, title, dateTime: expiresAt };
  }
  const ago = -left;
  if (ago > RELATIVE_EXPIRED_MS) {
    return { kind: 'exact', text: formatShortDate(expiresAt, timeZone), title, dateTime: expiresAt };
  }
  const text = ago < HOUR_MS ? 'Expired less than an hour ago' : `Expired ${span(ago)} ago`;
  return { kind: 'relative', text, title, dateTime: expiresAt };
}
