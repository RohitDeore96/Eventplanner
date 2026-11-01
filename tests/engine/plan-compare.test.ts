import { describe, expect, it } from 'vitest';
import { comparePlans } from '../../src/engine/planCompare';
import { makePlan, run } from '../helpers';
import { catId } from '../helpers';

/**
 * Direct guards for the extracted plan comparator — the shared impact engine behind
 * what-if previews and AI patch previews: money and guest deltas, added/removed and
 * rescheduled tasks, and warnings that appear or resolve.
 */

const today = '2026-11-01';

describe('comparePlans', () => {
  it('reports money and guest-target deltas between two plans', () => {
    const before = makePlan();
    const after = run(before, {
      type: 'event/update',
      changes: { guestTarget: before.guestTarget + 40, budgetMinor: before.budgetMinor + 1_000_00 },
    });
    const diff = comparePlans(before, after, today);
    expect(diff.guestTargetDelta).toBe(40);
    expect(diff.budgetDelta).toBe(1_000_00);
    expect(diff.committedDelta).toBe(0);
  });

  it('detects added, removed and rescheduled tasks by title', () => {
    const before = makePlan();
    const withTask = run(before, {
      type: 'task/add',
      id: 't-new',
      title: 'Book the band',
      dueISO: '2026-12-10',
      dependsOn: [],
      assignee: null,
    });
    const rescheduled = run(withTask, {
      type: 'task/update',
      id: 't-new',
      dueISO: '2026-12-12',
    });
    const diff = comparePlans(withTask, rescheduled, today);
    expect(diff.tasksAdded).toEqual([]);
    expect(diff.tasksRescheduled).toEqual([
      { id: 't-new', title: 'Book the band', from: '2026-12-10', to: '2026-12-12' },
    ]);
    const removed = run(rescheduled, { type: 'task/delete', id: 't-new' });
    expect(comparePlans(rescheduled, removed, today).tasksRemoved).toEqual(['Book the band']);
  });

  it('sees identical plans as a zero comparison with no warning changes', () => {
    const plan = makePlan();
    const diff = comparePlans(plan, plan, today);
    expect(diff.budgetDelta).toBe(0);
    expect(diff.tasksRescheduled).toEqual([]);
    expect(diff.newWarnings).toEqual([]);
    expect(diff.resolvedWarnings).toEqual([]);
    expect(diff.categories.every((c) => c.plannedBefore === c.plannedAfter)).toBe(true);
  });

  it('keeps per-category planned figures aligned with the engine', () => {
    const plan = makePlan();
    const venueId = catId(plan, 'venue');
    const raised = run(plan, { type: 'category/update', id: venueId, plannedMinor: 900_000_00 });
    const diff = comparePlans(plan, raised, today);
    const venue = diff.categories.find((c) => c.categoryId === venueId);
    const beforePlanned = plan.categories.find((c) => c.id === venueId)?.plannedMinor;
    if (venue === undefined || beforePlanned === undefined) {
      throw new Error('venue missing from comparison');
    }
    expect(venue.plannedAfter - venue.plannedBefore).toBe(900_000_00 - beforePlanned);
  });
});
