import { describe, expect, it } from 'vitest';
import { makePlan, run, errorCode } from '../helpers';
import type { RunSheetEntry } from '../../src/engine/types';
import { minutesOf, orderedRunSheet, runSheetConflicts } from '../../src/engine/runsheet';

const base = {
  id: 'r1',
  title: 'Venue setup',
  dateISO: '2027-03-15',
  startTime: '09:00',
  endTime: '11:00',
  ownerId: null,
  location: 'Lawn',
  note: '',
};

const add = (over: Partial<Omit<typeof base, 'ownerId'>> & { ownerId?: string | null } = {}) => ({
  type: 'runsheet/add' as const,
  ...base,
  ...over,
});

const entry = (over: Partial<typeof base> = {}): RunSheetEntry => ({
  ...base,
  done: false,
  ...over,
});

describe('run sheet validation', () => {
  it('adds a valid entry and defaults done to false', () => {
    const plan = run(makePlan(), add());
    expect(plan.runSheet).toHaveLength(1);
    expect(plan.runSheet[0]?.done).toBe(false);
    expect(plan.runSheet[0]?.title).toBe('Venue setup');
  });

  it('rejects times that are not HH:MM 24-hour', () => {
    expect(errorCode(makePlan(), add({ startTime: '9am' }))).toBe('INVALID_TIME');
    expect(errorCode(makePlan(), add({ endTime: '25:00' }))).toBe('INVALID_TIME');
  });

  it('rejects an end time at or before the start', () => {
    expect(errorCode(makePlan(), add({ endTime: '09:00' }))).toBe('TIME_BACKWARDS');
    expect(errorCode(makePlan(), add({ startTime: '12:00' }))).toBe('TIME_BACKWARDS');
  });

  it('rejects an owner that is not a vendor of this plan', () => {
    expect(errorCode(makePlan(), add({ ownerId: 'v-ghost' }))).toBe('VENDOR_NOT_FOUND');
  });

  it('rejects impossible dates and empty titles', () => {
    expect(errorCode(makePlan(), add({ dateISO: '2027-02-30' }))).toBe('INVALID_DATE');
    expect(errorCode(makePlan(), add({ title: '   ' }))).toBe('NAME_REQUIRED');
  });
});

describe('run sheet operations', () => {
  it('updates fields and keeps the end-after-start rule across combined edits', () => {
    const plan = run(
      makePlan(),
      add(),
      add({ id: 'r2', title: 'Catering arrival', startTime: '12:00', endTime: '13:00' }),
    );
    const moved = run(plan, { type: 'runsheet/update', id: 'r2', startTime: '10:00' });
    expect(moved.runSheet.find((e) => e.id === 'r2')?.startTime).toBe('10:00');
    // moving the start of r1 to 13:00 would leave its own end at 11:00 — rejected.
    expect(errorCode(moved, { type: 'runsheet/update', id: 'r1', startTime: '13:00' })).toBe(
      'TIME_BACKWARDS',
    );
  });

  it('toggles done and deletes entries', () => {
    const plan = run(makePlan(), add(), { type: 'runsheet/toggle', id: 'r1', done: true });
    expect(plan.runSheet[0]?.done).toBe(true);
    const afterDelete = run(plan, { type: 'runsheet/delete', id: 'r1' });
    expect(afterDelete.runSheet).toHaveLength(0);
    expect(errorCode(afterDelete, { type: 'runsheet/toggle', id: 'r1', done: true })).toBe(
      'ENTRY_NOT_FOUND',
    );
  });

  it('reorders within bounds only', () => {
    const plan = run(
      makePlan(),
      add(),
      add({ id: 'r2', title: 'Second' }),
      add({ id: 'r3', title: 'Third' }),
    );
    const reordered = run(plan, { type: 'runsheet/reorder', id: 'r3', toIndex: 0 });
    expect(reordered.runSheet[0]?.title).toBe('Third');
    expect(errorCode(reordered, { type: 'runsheet/reorder', id: 'r1', toIndex: 9 })).toBe(
      'INVALID_INDEX',
    );
  });
});

describe('run sheet conflicts (M11.3)', () => {
  it('detects overlapping activities on the same day, not across days', () => {
    const entries = [
      entry(),
      entry({ id: 'r2', title: 'Overlapping', startTime: '10:30', endTime: '12:00' }),
      entry({ id: 'r3', title: 'Next day', dateISO: '2027-03-16' }),
      entry({ id: 'r4', title: 'Later', startTime: '13:00', endTime: '14:00' }),
    ];
    const conflicts = runSheetConflicts(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ firstId: 'r1', secondId: 'r2' });
  });

  it('flags the same vendor double-booked even without a time overlap', () => {
    const plan = run(makePlan(), {
      type: 'vendor/add',
      id: 'v1',
      categoryId: makePlan().categories[0]?.id ?? 'c',
      name: 'Florist',
      contactNote: '',
      status: 'contacted',
      committedMinor: null,
    });
    const vendorId = plan.vendors[0]?.id ?? 'v1';
    const entries: RunSheetEntry[] = [
      { ...base, ownerId: vendorId, done: false },
      {
        ...base,
        id: 'r2',
        title: 'Elsewhere',
        startTime: '12:00',
        endTime: '13:00',
        ownerId: vendorId,
        done: false,
      },
    ];
    const conflicts = runSheetConflicts(entries);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.dateISO).toBe('2027-03-15');
  });

  it('orders entries by date then start time', () => {
    const ordered = orderedRunSheet([
      entry({ id: 'b', startTime: '10:00', dateISO: '2027-03-16' }),
      entry({ id: 'a', startTime: '09:00' }),
      entry({ id: 'c', startTime: '08:00' }),
    ]);
    expect(ordered.map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });

  it('computes minutes since midnight', () => {
    expect(minutesOf('09:30')).toBe(570);
    expect(minutesOf('00:00')).toBe(0);
    expect(minutesOf('23:59')).toBe(1439);
  });
});
