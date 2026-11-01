import { describe, expect, it } from 'vitest';
import type { RunSheetEntry } from '../../src/engine/types';
import {
  orderedRunSheet,
  runSheetConflicts,
  runSheetSpan,
} from '../../src/engine/runsheetSchedule';

/**
 * Direct guards for the extracted run-sheet read models: same-day overlap detection,
 * same-vendor double-booking, the stable display order and the scheduled span.
 */

const entry = (overrides: Partial<RunSheetEntry>): RunSheetEntry => ({
  id: 'r-1',
  title: 'Activity',
  dateISO: '2026-12-20',
  startTime: '09:00',
  endTime: '10:00',
  ownerId: null,
  location: '',
  note: '',
  done: false,
  ...overrides,
});

describe('run-sheet read models', () => {
  it('flags overlapping same-day activities once, with a stable pair key', () => {
    const entries = [
      entry({ id: 'a', startTime: '09:00', endTime: '10:00' }),
      entry({ id: 'b', startTime: '09:30', endTime: '10:30' }),
      entry({ id: 'c', startTime: '11:00', endTime: '12:00' }),
      entry({ id: 'd', startTime: '10:00', endTime: '11:00' }),
    ];
    const conflicts = runSheetConflicts(entries);
    // a overlaps b (09:30 < 10:00); b overlaps d (10:00 < 10:30); c touches nothing.
    expect(conflicts).toEqual([
      { firstId: 'a', secondId: 'b', dateISO: '2026-12-20' },
      { firstId: 'b', secondId: 'd', dateISO: '2026-12-20' },
    ]);
  });

  it('surfaces same-vendor double-booking even without a time overlap', () => {
    const entries = [
      entry({ id: 'a', startTime: '09:00', endTime: '10:00', ownerId: 'v-1' }),
      entry({ id: 'b', startTime: '12:00', endTime: '13:00', ownerId: 'v-1' }),
    ];
    expect(runSheetConflicts(entries)).toEqual([
      { firstId: 'a', secondId: 'b', dateISO: '2026-12-20' },
    ]);
  });

  it('never flags activities on different days', () => {
    const entries = [
      entry({ id: 'a', startTime: '09:00', endTime: '10:00' }),
      entry({ id: 'b', startTime: '09:30', endTime: '10:30', dateISO: '2026-12-21' }),
    ];
    expect(runSheetConflicts(entries)).toEqual([]);
  });

  it('orders by date then start time and keeps insertion order for ties', () => {
    const ordered = orderedRunSheet([
      entry({ id: 'late', dateISO: '2026-12-21', startTime: '08:00' }),
      entry({ id: 'b', startTime: '10:00' }),
      entry({ id: 'a', startTime: '09:00' }),
    ]);
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b', 'late']);
  });

  it('sums the scheduled span across entries', () => {
    expect(
      runSheetSpan([
        entry({ startTime: '09:00', endTime: '10:30' }),
        entry({ startTime: '12:00', endTime: '12:20' }),
      ]),
    ).toBe(110);
    expect(runSheetSpan([])).toBe(0);
  });
});
