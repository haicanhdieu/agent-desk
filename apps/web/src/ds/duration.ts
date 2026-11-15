// Unit conversion for DurationInput: a limit typed as a number plus minutes, hours or days.

export type DurationUnit = 'minutes' | 'hours' | 'days';

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
/** From two days on, a duration reads in days ("2 d 3 h"); below, in hours ("36 h"), so 24 h stays "24 h". */
export const DAYS_FROM_MINUTES = 2 * MINUTES_PER_DAY;

const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: MINUTES_PER_HOUR, days: MINUTES_PER_DAY };

/** The largest unit that holds `minutes` exactly (days only from two days). */
export function splitMinutes(minutes: number): { value: string; unit: DurationUnit } {
  if (minutes >= DAYS_FROM_MINUTES && minutes % MINUTES_PER_DAY === 0) {
    return { value: String(minutes / MINUTES_PER_DAY), unit: 'days' };
  }
  if (minutes >= MINUTES_PER_HOUR && minutes % MINUTES_PER_HOUR === 0) {
    return { value: String(minutes / MINUTES_PER_HOUR), unit: 'hours' };
  }
  return { value: String(minutes), unit: 'minutes' };
}

/** A typed value in `unit` as minutes; NaN when it is not a number (the server then rejects it with a message). */
export function minutesIn(value: string, unit: DurationUnit): number {
  return Number(value) * UNIT_MINUTES[unit];
}
