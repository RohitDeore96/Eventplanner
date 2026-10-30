import { MAX_YEAR, MIN_YEAR } from '../config/limits.js';

/** Calendar date as `YYYY-MM-DD`. The engine never reads the clock; callers pass `today`. */
export type ISODate = string;

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 (UTC), or null when the string is not a real calendar date in range. */
export function parseISODate(value: string): number | null {
  const match = ISO_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const ms = Date.UTC(year, month - 1, day);
  // Any overflow (month 13, day 31 in April, day 0) rolls into a different month, so one
  // round-trip check on the month is enough to reject every impossible date.
  if (new Date(ms).getUTCMonth() !== month - 1) return null;
  return ms / MS_PER_DAY;
}

export function formatISODate(dayNumber: number): ISODate {
  return new Date(dayNumber * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isValidISODate(value: string): boolean {
  return parseISODate(value) !== null;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). Null if either is invalid. */
export function daysBetween(from: ISODate, to: ISODate): number | null {
  const a = parseISODate(from);
  const b = parseISODate(to);
  return a === null || b === null ? null : b - a;
}

export function addDays(value: ISODate, days: number): ISODate | null {
  const base = parseISODate(value);
  if (base === null || !Number.isInteger(days)) return null;
  const next = base + days;
  const formatted = formatISODate(next);
  return parseISODate(formatted) === null ? null : formatted;
}
