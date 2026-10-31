import { describe, expect, it } from 'vitest';
import { catId, errorCode, makePlan, run } from '../helpers';
import { tradeOffActions, tradeOffFor } from '../../src/engine/tradeoff';

describe('category locks (M10.1)', () => {
  it('a locked category refuses budget moves in either direction', () => {
    const venue = catId(makePlan(), 'venue');
    const catering = catId(makePlan(), 'catering');
    const locked = run(makePlan(), { type: 'category/update', id: venue, locked: true });
    expect(
      errorCode(locked, { type: 'budget/move', fromId: venue, toId: catering, amountMinor: 1000 }),
    ).toBe('CATEGORY_LOCKED');
    expect(
      errorCode(locked, { type: 'budget/move', fromId: catering, toId: venue, amountMinor: 1000 }),
    ).toBe('CATEGORY_LOCKED');
    // unlocking restores the normal rules
    const unlocked = run(locked, { type: 'category/update', id: venue, locked: false });
    expect(
      errorCode(unlocked, {
        type: 'budget/move',
        fromId: venue,
        toId: catering,
        amountMinor: 1000,
      }),
    ).toBe('OK');
  });

  it('a locked category refuses allocation edits but keeps its name editable', () => {
    const venue = catId(makePlan(), 'venue');
    const locked = run(makePlan(), { type: 'category/update', id: venue, locked: true });
    expect(errorCode(locked, { type: 'category/update', id: venue, plannedMinor: 5_000_000 })).toBe(
      'CATEGORY_LOCKED',
    );
    const renamed = run(locked, { type: 'category/update', id: venue, name: 'Grand venue' });
    expect(renamed.categories.find((c) => c.id === venue)?.name).toBe('Grand venue');
  });
});

describe('trade-off planner (M10.3)', () => {
  it('funds from unallocated budget first and never touches a plan that fits', () => {
    const plan = makePlan();
    const venue = catId(plan, 'venue');
    // Give the event extra unallocated money by trimming every allocation via the engine.
    const trimmed = run(
      plan,
      ...plan.categories.map((c) => ({
        type: 'category/update' as const,
        id: c.id,
        plannedMinor: Math.floor(c.plannedMinor / 2),
      })),
    );
    const proposal = tradeOffFor(trimmed, venue, 1_000_000);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.value.sources).toHaveLength(0);
    expect(proposal.value.unallocatedAfter).toBe(proposal.value.unallocatedBefore - 1_000_000);
    const plannedBefore = trimmed.categories.find((c) => c.id === venue)?.plannedMinor ?? 0;
    expect(proposal.value.plannedAfter).toBe(plannedBefore + 1_000_000);
  });

  it('takes from the freest unlocked categories, leaving committed money alone', () => {
    const plan = makePlan();
    const venue = catId(plan, 'venue');
    const decor = catId(plan, 'decor');
    // Decor is uncommitted, so its whole allocation is slack; venue is committed elsewhere.
    const withVendor = run(plan, {
      type: 'vendor/add',
      id: 'v1',
      categoryId: venue,
      name: 'Venue Co',
      contactNote: '',
      status: 'booked',
      committedMinor: 5_000_000,
    });
    const proposal = tradeOffFor(withVendor, decor, 2_000_000);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.value.sources.length).toBeGreaterThan(0);
    // The venue has slack (planned − committed = plenty), it may be used — but never below
    // its committed amount.
    const venueSource = proposal.value.sources.find((s) => s.categoryId === venue);
    if (venueSource !== undefined) {
      const venueCategory = withVendor.categories.find((c) => c.id === venue);
      expect(venueSource.plannedAfter).toBeGreaterThanOrEqual(5_000_000);
      expect(venueCategory).toBeDefined();
    }
  });

  it('never proposes touching a locked category', () => {
    const plan = makePlan();
    const venue = catId(plan, 'venue');
    const catering = catId(plan, 'catering');
    const locked = run(plan, { type: 'category/update', id: catering, locked: true });
    const proposal = tradeOffFor(locked, venue, 500_000_000);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.value.sources.find((s) => s.categoryId === catering)).toBeUndefined();
    // Catering's budget is large and locked, so a big increase cannot be fully funded.
    expect(proposal.value.shortfallMinor).toBeGreaterThan(0);
  });

  it('refuses to fund a locked target or a non-existent category', () => {
    const plan = run(makePlan(), {
      type: 'category/update',
      id: catId(makePlan(), 'venue'),
      locked: true,
    });
    expect(
      errorCode(makePlan(), {
        type: 'budget/move',
        fromId: catId(makePlan(), 'venue'),
        toId: catId(makePlan(), 'venue'),
        amountMinor: 1,
      }),
    ).toBe('SAME_CATEGORY');
    const venue = catId(plan, 'venue');
    const refused = tradeOffFor(plan, venue, 1000);
    expect(refused.ok).toBe(false);
    const ghost = tradeOffFor(plan, 'no-such-id', 1000);
    expect(ghost.ok).toBe(false);
  });

  it('reports the shortfall honestly and refuses to emit budget-breaking actions', () => {
    const plan = makePlan();
    const venue = catId(plan, 'venue');
    const proposal = tradeOffFor(plan, venue, 900_000_000_000);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.value.shortfallMinor).toBeGreaterThan(0);
    // A shortfall proposal produces NO actions: applying nothing is the only safe move,
    // and the UI shows the shortfall instead of an Apply button.
    expect(tradeOffActions(proposal.value)).toHaveLength(0);

    // A fundable trade-off, by contrast, applies within the budget.
    const small = tradeOffFor(plan, venue, 100_000);
    expect(small.ok).toBe(true);
    if (!small.ok) return;
    const applied = run(plan, ...tradeOffActions(small.value));
    const totalPlanned = applied.categories.reduce((acc, c) => acc + c.plannedMinor, 0);
    expect(totalPlanned).toBeLessThanOrEqual(applied.budgetMinor);
  });
});
