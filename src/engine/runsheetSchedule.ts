import type { RunSheetEntry } from './types.js';
import { minutesOf } from './runsheet.js';

/**
 * Read models over the stored run sheet: overlap conflicts (shown for deliberate
 * correction — never silently resolved, 11.3), the stable display order and the
 * day's scheduled span. Pure queries; no validation and no plan mutation here.
 */

export interface RunSheetConflict {
  readonly firstId: string;
  readonly secondId: string;
  readonly dateISO: string;
}

/**
 * Overlapping activities on the same day: shown to the user for deliberate correction —
 * never silently moved (11.3). Same-vendor double-booking is also surfaced.
 */
export function runSheetConflicts(entries: readonly RunSheetEntry[]): RunSheetConflict[] {
  const conflicts: RunSheetConflict[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      // The loop bounds guarantee both entries exist; the date guard is what matters.
      if (a === undefined || b === undefined) continue;
      if (a.dateISO !== b.dateISO) continue;
      const overlap =
        minutesOf(a.startTime) < minutesOf(b.endTime) &&
        minutesOf(b.startTime) < minutesOf(a.endTime);
      const sameOwner = a.ownerId !== null && b.ownerId !== null && a.ownerId === b.ownerId;
      if (overlap || sameOwner) {
        const key = [a.id, b.id].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({ firstId: a.id, secondId: b.id, dateISO: a.dateISO });
        }
      }
    }
  }
  return conflicts;
}

/** Stable display order: by date, then start time, then insertion order. */
export function orderedRunSheet(entries: readonly RunSheetEntry[]): readonly RunSheetEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.dateISO.localeCompare(b.dateISO) || minutesOf(a.startTime) - minutesOf(b.startTime) || 0,
  );
}

/** Total scheduled span in minutes, for the day summary (never money, so no cap worry). */
export function runSheetSpan(entries: readonly RunSheetEntry[]): number {
  return entries.reduce((acc, e) => acc + (minutesOf(e.endTime) - minutesOf(e.startTime)), 0);
}
