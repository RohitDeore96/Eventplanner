import { describe, expect, it } from 'vitest';
import { catId, errorCode, makePlan, run, deepFreeze } from '../helpers';
import { reducePlan } from '../../src/engine/reducer';

/**
 * Engine branch coverage for the Phase 2 reducers: every rejection path returns a typed
 * failure, never throws, and leaves the plan untouched.
 */

const entry = (over: Record<string, unknown> = {}) => ({
  type: 'runsheet/add' as const,
  id: 'r1',
  title: 'Setup',
  dateISO: '2027-03-15',
  startTime: '09:00',
  endTime: '10:00',
  ownerId: null,
  location: 'Lawn',
  note: '',
  ...over,
});

describe('run sheet reducer branches', () => {
  it('rejects oversized locations, unknown update targets and bad indexes', () => {
    expect(errorCode(makePlan(), entry({ location: 'x'.repeat(121) }))).toBe('TEXT_TOO_LONG');
    expect(errorCode(makePlan(), { type: 'runsheet/update', id: 'nope', title: 'X' })).toBe(
      'ENTRY_NOT_FOUND',
    );
    expect(errorCode(makePlan(), { type: 'runsheet/delete', id: 'nope' })).toBe('ENTRY_NOT_FOUND');
    expect(errorCode(makePlan(), { type: 'runsheet/reorder', id: 'nope', toIndex: 0 })).toBe(
      'ENTRY_NOT_FOUND',
    );
    const seeded = run(
      makePlan(),
      entry(),
      entry({ id: 'r2', title: 'Two', startTime: '11:00', endTime: '12:00' }),
    );
    expect(errorCode(seeded, { type: 'runsheet/reorder', id: 'r1', toIndex: 99 })).toBe(
      'INVALID_INDEX',
    );
  });

  it('validates the owner on add and update alike', () => {
    const withVendor = run(makePlan(), {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(makePlan(), 'venue'),
      name: 'Venue Co',
      contactNote: '',
      status: 'contacted',
      committedMinor: null,
    });
    const vendorId = withVendor.vendors[0]?.id ?? 'v1';
    expect(errorCode(withVendor, entry({ ownerId: 'ghost' }))).toBe('VENDOR_NOT_FOUND');
    const owned = run(withVendor, entry({ ownerId: vendorId }));
    expect(errorCode(owned, { type: 'runsheet/update', id: 'r1', ownerId: 'ghost' })).toBe(
      'VENDOR_NOT_FOUND',
    );
    expect(errorCode(owned, { type: 'runsheet/update', id: 'r1', ownerId: null })).toBe('OK');
  });

  it('caps the run sheet size', () => {
    let plan = makePlan();
    for (let i = 0; i < 100; i += 1) {
      const next = reducePlan(plan, entry({ id: `r${i}` }), { today: '2026-10-30' });
      if (!next.ok) throw new Error(`add ${i} failed: ${next.error.code}`);
      plan = next.value;
    }
    expect(errorCode(plan, entry({ id: 'r-over' }))).toBe('TOO_MANY_ENTRIES');
  });

  it('accepts a full optional surface (owner, location, note, next-day slot)', () => {
    const withVendor = run(makePlan(), {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(makePlan(), 'venue'),
      name: 'Venue Co',
      contactNote: '',
      status: 'contacted',
      committedMinor: null,
    });
    const vendorId = withVendor.vendors[0]?.id ?? 'v1';
    const plan = run(
      withVendor,
      entry({
        ownerId: vendorId,
        location: 'Main gate',
        note: '协调 with the band',
        dateISO: '2027-03-16',
      }),
    );
    expect(plan.runSheet).toHaveLength(1);
    expect(plan.runSheet[0]?.ownerId).toBe(vendorId);
    expect(deepFreeze(plan).runSheet).toHaveLength(1);
  });
});

describe('guest text field branches', () => {
  it('caps contact and note lengths on add and update', () => {
    const base = {
      type: 'guest/add' as const,
      id: 'g1',
      name: 'Meera',
      rsvp: 'yes' as const,
      plusOnes: 0,
      dietary: [],
      group: 'Family',
    };
    expect(errorCode(makePlan(), { ...base, contact: 'x'.repeat(121) })).toBe('NOTE_TOO_LONG');
    expect(errorCode(makePlan(), { ...base, note: 'x'.repeat(501) })).toBe('NOTE_TOO_LONG');
    const guest = run(makePlan(), base);
    expect(errorCode(guest, { type: 'guest/update', id: 'g1', note: 'x'.repeat(501) })).toBe(
      'NOTE_TOO_LONG',
    );
    const updated = run(guest, {
      type: 'guest/update',
      id: 'g1',
      contact: 'meera@example.com',
      note: 'Prefers jain menu',
    });
    expect(updated.guests[0]?.contact).toBe('meera@example.com');
    expect(updated.guests[0]?.note).toBe('Prefers jain menu');
  });
});

describe('vendor contact field branches', () => {
  it('rejects wrong-typed and malformed contact details', () => {
    const base = {
      type: 'vendor/add' as const,
      id: 'v1',
      categoryId: catId(makePlan(), 'venue'),
      name: 'Venue Co',
      contactNote: '',
      status: 'contacted' as const,
      committedMinor: null,
    };
    expect(errorCode(makePlan(), { ...base, contactPerson: 42 as unknown as string })).toBe(
      'INVALID_TEXT',
    );
    expect(errorCode(makePlan(), { ...base, phone: {} as unknown as string })).toBe('INVALID_TEXT');
    expect(errorCode(makePlan(), { ...base, email: 'not-an-email' })).toBe('INVALID_EMAIL');
    expect(errorCode(makePlan(), { ...base, contactPerson: 'x'.repeat(121) })).toBe(
      'TEXT_TOO_LONG',
    );
    expect(errorCode(makePlan(), { ...base, phone: 'x'.repeat(41) })).toBe('TEXT_TOO_LONG');
    expect(errorCode(makePlan(), { ...base, email: 'x'.repeat(121) })).toBe('TEXT_TOO_LONG');
    const updated = run(
      makePlan(),
      { ...base },
      { type: 'vendor/update', id: 'v1', contactPerson: 'Sunita', email: 's@v.co' },
    );
    expect(updated.vendors[0]?.contactPerson).toBe('Sunita');
    expect(updated.vendors[0]?.email).toBe('s@v.co');
    expect(errorCode(updated, { type: 'vendor/update', id: 'v1', email: 'broken' })).toBe(
      'INVALID_EMAIL',
    );
  });

  it('normalizes a schedule note and rejects an oversized one', () => {
    const vendorPlan = run(makePlan(), {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(makePlan(), 'venue'),
      name: 'Venue Co',
      contactNote: '',
      status: 'booked',
      committedMinor: 1_000_000,
    });
    const withSchedule = run(vendorPlan, {
      type: 'vendor/setSchedule',
      id: 'v1',
      schedule: [{ id: 'i1', kind: 'advance', dueISO: '2027-01-01', amountMinor: 100 }],
    });
    expect(withSchedule.vendors[0]?.schedule[0]?.note).toBe('');
    expect(
      errorCode(vendorPlan, {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: [
          {
            id: 'i1',
            kind: 'advance',
            dueISO: '2027-01-01',
            amountMinor: 100,
            note: 'x'.repeat(501),
          },
        ],
      }),
    ).toBe('NOTE_TOO_LONG');
  });
});
