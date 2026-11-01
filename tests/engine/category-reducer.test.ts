import { describe, expect, it } from 'vitest';
import { makePlan, run } from '../helpers';
import {
  addCategory,
  deleteCategory,
  moveBudget,
  updateCategory,
} from '../../src/engine/reducers/categories';
import { catId } from '../helpers';

/**
 * Direct guards for the extracted category/allocation reducers: duplicate-name rules,
 * the lock guards on allocations and moves, the in-use delete guard and the exact
 * money move. Error codes are the public contract the UI maps to notices.
 */

describe('category allocation reducers', () => {
  it('rejects duplicate ids and case-insensitive duplicate names', () => {
    const plan = makePlan();
    expect(addCategory(plan, 'c-x', 'Venue', 100_000)).toMatchObject({ ok: false });
    expect(addCategory(plan, 'c-x', 'Completely new', 100_000)).toMatchObject({ ok: true });
    const withNew = run(plan, {
      type: 'category/add',
      id: 'c-x',
      name: 'Completely new',
      plannedMinor: 100_000,
    });
    expect(addCategory(withNew, 'c-y', 'completely NEW', 1)).toMatchObject({ ok: false });
  });

  it('refuses to change the allocation of a locked category but allows the name', () => {
    const plan = makePlan();
    const venueId = catId(plan, 'venue');
    const locked = run(plan, { type: 'category/update', id: venueId, locked: true });
    expect(updateCategory(locked, venueId, undefined, 1)).toMatchObject({ ok: false });
    const renamed = updateCategory(locked, venueId, 'Grand hall');
    expect(renamed).toMatchObject({ ok: true });
  });

  it('moves money only between unlocked categories and never beyond the planned amount', () => {
    const plan = makePlan();
    const venue = catId(plan, 'venue');
    const catering = catId(plan, 'catering');
    const locked = run(plan, { type: 'category/update', id: venue, locked: true });
    expect(moveBudget(locked, venue, catering, 1)).toMatchObject({ ok: false });
    const moved = moveBudget(plan, venue, catering, 50_000);
    expect(moved).toMatchObject({ ok: true });
    if (moved.ok) {
      const from = moved.value.categories.find((c) => c.id === venue);
      const to = moved.value.categories.find((c) => c.id === catering);
      expect(from?.plannedMinor).toBe(
        (plan.categories.find((c) => c.id === venue)?.plannedMinor ?? 0) - 50_000,
      );
      expect(to?.plannedMinor).toBe(
        (plan.categories.find((c) => c.id === catering)?.plannedMinor ?? 0) + 50_000,
      );
    }
    expect(moveBudget(plan, venue, catering, 10_000_000_000)).toMatchObject({ ok: false });
  });

  it('keeps a category with vendors or expenses from being deleted', () => {
    const plan = makePlan();
    const venueId = catId(plan, 'venue');
    const withVendor = run(plan, {
      type: 'vendor/add',
      id: 'v-x',
      categoryId: venueId,
      name: 'Hall owner',
      contactNote: '',
      status: 'quoted',
      committedMinor: null,
    });
    expect(deleteCategory(withVendor, venueId)).toMatchObject({ ok: false });
    const empty = addCategory(plan, 'c-empty', 'Photo albums', 5_000);
    if (!empty.ok) throw new Error('category add failed');
    expect(deleteCategory(empty.value, 'c-empty')).toMatchObject({ ok: true });
  });
});
