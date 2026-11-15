// Run time limit display and entry (ADR 0021): limits run from a minute to 7 days, so plain minutes stop being readable.

const pad = (n: number) => String(n).padStart(2, '0');

import { DAYS_FROM_MINUTES, MINUTES_PER_DAY, MINUTES_PER_HOUR } from '@/ds';

/** "30 min", "1 h 30 min", "24 h", "2 d 3 h": a limit in seconds, rounded to whole minutes like the limit field. */
export function formatLimit(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (safe < 60) return `${Math.floor(safe)} s`;
  const total = Math.round(safe / 60);
  const parts: string[] = [];
  let rest = total;
  if (total >= DAYS_FROM_MINUTES) {
    parts.push(`${Math.floor(rest / MINUTES_PER_DAY)} d`);
    rest %= MINUTES_PER_DAY;
  }
  const hours = Math.floor(rest / MINUTES_PER_HOUR);
  if (hours > 0) parts.push(`${hours} h`);
  const minutes = rest % MINUTES_PER_HOUR;
  if (minutes > 0) parts.push(`${minutes} min`);
  return parts.join(' ');
}

/** The running clock: "7:40", "1:05:03", "1d 01:01:01". */
export function clockElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600) % 24;
  const d = Math.floor(total / 86400);
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (total >= 3600) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}
