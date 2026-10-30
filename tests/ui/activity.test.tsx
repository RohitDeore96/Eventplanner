/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer } from '../../src/state/planState';
import { makePlan, TODAY, catId } from '../helpers';
import { ActivityView } from '../../src/ui/views/ActivityView';
import type { Plan } from '../../src/engine/types';
import type { PlanAction } from '../../src/engine/actions';

/**
 * X9 UI acceptance: every change shows as one line in the Activity tab, newest first;
 * Undo strikes the newest entry out (marked "undone") and Redo puts it back; an empty
 * session says so honestly.
 */

function Harness({ seed }: { seed: Plan }): React.ReactNode {
  const [state, setState] = useState(() => initPlanState(seed));
  const store: Store = {
    plan: seed,
    state,
    dispatch: (event) => {
      setState(planReducer(state, event, TODAY));
    },
    apply: (action) => {
      const next = planReducer(state, { kind: 'apply', action }, TODAY);
      setState(next);
      return next.lastError === null
        ? { ok: true, message: null }
        : { ok: false, message: next.lastError.message, field: next.lastError.field ?? '' };
    },
    applyAll: () => ({ ok: true, message: null }),
    replace: () => undefined,
    undo: () => {
      setState(planReducer(state, { kind: 'undo' }, TODAY));
    },
    redo: () => {
      setState(planReducer(state, { kind: 'redo' }, TODAY));
    },
  };
  const addGuest: PlanAction = {
    type: 'guest/add',
    id: 'g1',
    name: 'Meera',
    rsvp: 'yes',
    plusOnes: 0,
    dietary: [],
    group: '',
  };
  const addExpense: PlanAction = {
    type: 'expense/add',
    id: 'e1',
    categoryId: catId(seed, 'venue'),
    vendorId: null,
    instalmentId: null,
    dateISO: TODAY,
    amountMinor: 500_000,
    note: 'venue advance',
  };
  return (
    <PlanContext.Provider value={store}>
      <ActivityView />
      <button type="button" onClick={() => store.apply(addGuest)}>
        Add guest
      </button>
      <button type="button" onClick={() => store.apply(addExpense)}>
        Add expense
      </button>
      <button type="button" onClick={store.undo}>
        Undo
      </button>
      <button type="button" onClick={store.redo}>
        Redo
      </button>
    </PlanContext.Provider>
  );
}

describe('activity view (X9 UI)', () => {
  it('lists changes newest first, marks an undone entry, and Redo restores it', async () => {
    const user = userEvent.setup();
    render(<Harness seed={makePlan()} />);

    // Fresh session: honest empty state.
    expect(screen.getByText('No changes yet in this session.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add guest' }));
    expect(screen.getByText('Guest “Meera” added (yes)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add expense' }));
    expect(screen.getByText(/Expense ₹5,000.*venue advance/)).toBeInTheDocument();

    // Newest first: the expense line sits above the guest line.
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('venue advance');
    expect(items[1]?.textContent).toContain('Meera');

    // Undo strikes the newest entry (the expense) only.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    const undoneBadge = screen.getByText('undone');
    expect(undoneBadge.closest('li')?.textContent).toContain('venue advance');
    expect(items[1]?.textContent).not.toContain('undone');

    // Redo puts it back.
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.queryByText('undone')).toBeNull();
  });
});
