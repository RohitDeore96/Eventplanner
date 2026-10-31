import { describe, expect, it } from 'vitest';
import { catId, makePlan, run } from '../helpers';
import { duplicatePlan } from '../../src/engine/duplicate';

describe('event duplication (M13.4)', () => {
  it('copies every record under a brand-new id set, preserving internal relationships', () => {
    const plan = makePlan();
    const venue = catId(plan, 'venue');
    const withVendor = run(
      plan,
      {
        type: 'vendor/add',
        id: 'v1',
        categoryId: venue,
        name: 'Venue Co',
        contactNote: '',
        status: 'booked',
        committedMinor: 5_000_000,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: [{ id: 'i1', kind: 'advance', dueISO: '2027-01-01', amountMinor: 1_000_000 }],
      },
      {
        type: 'expense/add',
        id: 'x1',
        categoryId: venue,
        vendorId: 'v1',
        instalmentId: 'i1',
        dateISO: '2027-01-02',
        amountMinor: 500_000,
        note: 'advance',
      },
      {
        type: 'guest/add',
        id: 'g1',
        name: 'Meera',
        rsvp: 'yes',
        plusOnes: 1,
        dietary: ['vegetarian'],
        group: 'Family',
      },
      {
        type: 'runsheet/add',
        id: 'r1',
        title: 'Baraat',
        dateISO: '2027-03-15',
        startTime: '19:00',
        endTime: '20:00',
        ownerId: 'v1',
        location: 'Gate',
        note: '',
      },
    );

    const copy = duplicatePlan(withVendor, 'ev-copy-1');
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const c = copy.value;

    expect(c.id).toBe('ev-copy-1');
    expect(c.name).toBe('Copy of Asha & Dev wedding');
    // Nothing points back at the original.
    expect(c.categories.map((x) => x.id)).not.toEqual(withVendor.categories.map((x) => x.id));
    expect(c.vendors.map((x) => x.id)).not.toContain('v1');
    expect(c.expenses.map((x) => x.id)).not.toContain('x1');
    expect(c.guests.map((x) => x.id)).not.toContain('g1');
    expect(c.runSheet.map((x) => x.id)).not.toContain('r1');

    // Internal relationships survive the remap.
    const newVendor = c.vendors[0];
    expect(newVendor?.name).toBe('Venue Co');
    expect(c.categories.map((x) => x.id)).toContain(newVendor?.categoryId);
    const newExpense = c.expenses[0];
    expect(newExpense?.vendorId).toBe(newVendor?.id);
    const newInstalmentId = newVendor?.schedule[0]?.id;
    expect(newInstalmentId).toBeDefined();
    expect(newExpense?.instalmentId).toBe(newInstalmentId);
    expect(newVendor?.schedule[0]?.amountMinor).toBe(1_000_000);
    // The run sheet owner points at the duplicate's vendor, not the original.
    expect(c.runSheet[0]?.ownerId).toBe(newVendor?.id);
    // Guest data is copied with its own id.
    expect(c.guests[0]?.name).toBe('Meera');
    expect(c.guests[0]?.dietary).toEqual(['vegetarian']);
    // Uniqueness inside the duplicate holds.
    const allIds = [
      ...c.categories.map((x) => x.id),
      ...c.vendors.map((x) => x.id),
      ...c.vendors.flatMap((x) => x.schedule.map((i) => i.id)),
      ...c.expenses.map((x) => x.id),
      ...c.tasks.map((x) => x.id),
      ...c.guests.map((x) => x.id),
      ...c.runSheet.map((x) => x.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('refuses the same id and an invalid id', () => {
    const plan = makePlan();
    expect(duplicatePlan(plan, plan.id).ok).toBe(false);
    expect(duplicatePlan(plan, 'not valid!').ok).toBe(false);
  });
});
