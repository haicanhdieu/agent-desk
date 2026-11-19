const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2 min ago", "3 hours ago", "yesterday", then a short UTC date ("12 Oct"). Pass `useNow()` as `now`. */
export function relativeTime(iso: string, now: Date): string {
  const at = new Date(iso);
  const diff = now.getTime() - at.getTime();
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (diff < 2 * DAY) return 'yesterday';
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/**
 * How long until `iso`, rounded to the nearest unit: "less than a minute", "45 min", "5 hours", "6 days". The unit is
 * the largest one that rounds to at least 1, so 59m40s reads "1 hour" and 23h50m reads "1 day". A past time is "less
 * than a minute".
 */
export function timeLeft(iso: string, now: Date): string {
  const diff = new Date(iso).getTime() - now.getTime();
  if (diff < MIN) return 'less than a minute';
  const mins = Math.round(diff / MIN);
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(diff / HOUR);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(diff / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}
