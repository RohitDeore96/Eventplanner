import { describe, expect, it } from 'vitest';
import { applyAction, applyAllActions, initHistory, redo, undo } from '../../src/engine/history';
import { catId, deepFreeze, makePlan, TODAY } from '../helpers';

/**
 * History acceptance: single actions are one undo step each, and a batch (scenario,
 * accepted quotation) folds into exactly ONE undo step — or nothing changes at all.
 */

describe('history batches', () => {
  it('applyAllActions folds many actions into ONE undo step', () => {
    const plan = deepFreeze(makePlan());
    const budgetBefore = plan.budgetMinor;
    const history = initHistory(plan);
    const actions = [
      { type: 'event/update', changes: { guestTarget: plan.guestTarget + 10 } },
      { type: 'event/update', changes: { budgetMinor: budgetBefore - 1_000_000 } },
    ] as const;
    const batched = applyAllActions(history, actions, { today: TODAY });
    expect(batched.ok).toBe(true);
    if (!batched.ok) return;
    expect(batched.value.past).toHaveLength(1); // ONE entry, not one per action
    const once = undo(batched.value);
    expect(once.present.budgetMinor).toBe(budgetBefore);
    expect(once.present.guestTarget).toBe(plan.guestTarget);
  });

  it('a failing batch changes nothing at all (all-or-nothing)', () => {
    const plan = makePlan();
    const history = initHistory(plan);
    const actions = [
      { type: 'event/update', changes: { guestTarget: plan.guestTarget + 5 } },
      // Updating a task that does not exist is rejected by the engine.
      { type: 'task/update', id: 'no-such-task', title: 'Ghost' },
    ] as const;
    const batched = applyAllActions(history, [...actions], { today: TODAY });
    expect(batched.ok).toBe(false);
    // The original history is untouched: no partial application.
    expect(history.past).toHaveLength(0);
    expect(history.present.budgetMinor).toBe(plan.budgetMinor);
  });

  it('undo and redo keep snapshots exact across single actions', () => {
    const plan = makePlan();
    let history = initHistory(plan);
    const moved = applyAction(
      history,
      {
        type: 'budget/move',
        fromId: catId(plan, 'venue'),
        toId: catId(plan, 'catering'),
        amountMinor: 1_000_000,
      },
      { today: TODAY },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    history = moved.value;
    const undone = undo(history);
    expect(undone.present.categories).toEqual(plan.categories);
    const redone = redo(undone);
    expect(redone.present.categories).toEqual(history.present.categories);
  });
});
