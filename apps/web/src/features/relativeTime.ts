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
