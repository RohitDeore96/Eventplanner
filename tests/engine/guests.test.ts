import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cateringRequirement, dietaryCounts, headcount } from '../../src/engine/guests';
import type { Guest, Rsvp } from '../../src/engine/types';
import { makePlan } from '../helpers';

const guest = (id: string, rsvp: Rsvp, plusOnes = 0, dietary: Guest['dietary'] = []): Guest => ({
  id,
  name: id,
  rsvp,
  plusOnes,
  dietary,
  group: '',
  contact: '',
  note: '',
});

describe('headcount', () => {
  it('counts each guest plus their plus-ones by RSVP', () => {
    const list = [
      guest('a', 'yes', 1),
      guest('b', 'yes'),
      guest('c', 'pending', 2),
      guest('d', 'no', 1),
    ];
    expect(headcount(list)).toEqual({ confirmed: 3, pending: 3, declined: 2, ifAllPendingCome: 6 });
  });
  it('handles an empty list', () => {
    expect(headcount([])).toEqual({ confirmed: 0, pending: 0, declined: 0, ifAllPendingCome: 0 });
  });
  it('property: confirmed + pending + declined equals everyone invited', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.constantFrom<Rsvp>('yes', 'no', 'pending'), fc.integer({ min: 0, max: 10 })),
          { maxLength: 300 },
        ),
        (rows) => {
          const list = rows.map(([rsvp, plus], i) => guest(`g${i}`, rsvp, plus));
          const h = headcount(list);
          return (
            h.confirmed + h.pending + h.declined ===
            list.length + rows.reduce((a, [, p]) => a + p, 0)
          );
        },
      ),
    );
  });
  it('does not crash with thousands of guests', () => {
    const list = Array.from({ length: 5000 }, (_, i) => guest(`g${i}`, 'yes', 10));
    expect(headcount(list).confirmed).toBe(55_000);
  });
});

describe('dietaryCounts', () => {
  it('counts confirmed guests only and each tag once per guest', () => {
    const list = [
      guest('a', 'yes', 0, ['vegan', 'vegan', 'nut_allergy']),
      guest('b', 'pending', 0, ['vegan']),
      guest('c', 'yes', 3, ['vegan']),
    ];
    expect(dietaryCounts(list)).toEqual({ vegan: 2, nut_allergy: 1 });
  });
});

describe('cateringRequirement', () => {
  it('uses the planned target until anyone confirms, then the confirmed headcount', () => {
    const plan = makePlan({ guestTarget: 100 });
    const before = cateringRequirement(plan, 3_000_000);
    expect(before).toMatchObject({ headcount: 100, basis: 'target', perHeadMinor: 30_000 });
    const withRsvps = { ...plan, guests: [guest('a', 'yes', 1, ['jain']), guest('b', 'pending')] };
    const after = cateringRequirement(withRsvps, 3_000_000);
    expect(after).toMatchObject({
      headcount: 2,
      basis: 'confirmed',
      perHeadMinor: 1_500_000,
      dietary: { jain: 1 },
    });
  });
  it('falls back to the target when guests exist but none confirmed, and never divides by zero', () => {
    const plan = { ...makePlan(), guests: [guest('a', 'pending')] };
    expect(cateringRequirement(plan, 1000).basis).toBe('target');
    expect(cateringRequirement({ ...plan, guestTarget: 0 }, 1000)).toMatchObject({
      headcount: 0,
      perHeadMinor: null,
    });
  });
});
