/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer, type PlanState } from '../../src/state/planState';
import { applyAction } from '../../src/engine/history';
import type { Plan } from '../../src/engine/types';
import { makePlan, run, TODAY } from '../helpers';
import { useState } from 'react';
import { GuestsView } from '../../src/ui/views/GuestsView';

/**
 * PRIORITY 3 regression: guests used to be created with `dietary: []` and the UI had no way
 * to manage dietary preferences at all. This walks the full journey: add with needs, edit
 * needs, filter, and verify the catering-facing counts.
 */

const basePlan: Plan = run(makePlan(), {
  type: 'guest/add',
  id: 'g1',
  name: 'Meera',
  rsvp: 'yes',
  plusOnes: 0,
  dietary: ['vegetarian'],
  group: 'Family',
});

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
    applyAll: (actions) => {
      let rolling = state.history;
      let error: PlanState['lastError'] = null;
      for (const action of actions) {
        const next = applyAction(rolling, action, { today: TODAY });
        if (!next.ok) {
          error = next.error;
          break;
        }
        rolling = next.value;
      }
      if (error === null) {
        setState({ ...state, history: rolling, lastError: null });
        return { ok: true, message: null };
      }
      return { ok: false, message: error.message, field: error.field ?? '' };
    },
    replace: (plan) => {
      setState(initPlanState(plan));
    },
    undo: () => {
      setState(planReducer(state, { kind: 'undo' }, TODAY));
    },
    redo: () => {
      setState(planReducer(state, { kind: 'redo' }, TODAY));
    },
  };
  return (
    <PlanContext.Provider value={store}>
      <GuestsView plan={state.history.present} />
    </PlanContext.Provider>
  );
}

describe('guest dietary management (P3)', () => {
  it('adds a guest with multiple dietary needs and shows the counts', async () => {
    const user = userEvent.setup();
    render(<Harness seed={basePlan} />);
    await user.type(screen.getByLabelText('Name'), 'Rohit');
    await user.type(screen.getByLabelText('Group (family, friends…)'), 'Friends');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Vegan' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Nut allergy' }));
    const addForm = screen.getByRole('button', { name: 'Add guest' }).closest('form');
    if (addForm === null) throw new Error('no add-guest form');
    fireEvent.submit(addForm);
    await waitFor(() => {
      expect(screen.getByText('Rohit')).toBeInTheDocument();
    });
    // The row shows the human-readable needs; counts include the new confirmed? Rohit is pending.
    const row = screen.getByText('Rohit').closest('tr');
    expect(row?.textContent).toContain('Vegan');
    expect(row?.textContent).toContain('Nut allergy');
    // Meera is confirmed and vegetarian; the summary counts confirmed guests per need.
    expect(screen.getAllByText(/Vegetarian ×1/).length).toBeGreaterThan(0);
  });

  it('edits an existing guest\u2019s dietary needs through the reducer (persisted in plan state)', async () => {
    const user = userEvent.setup();
    render(<Harness seed={basePlan} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit Meera' });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Jain' }));
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Vegetarian' }));
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Edit Meera' })).toBeNull();
    });
    const row = screen.getByText('Meera').closest('tr');
    expect(row?.textContent).toContain('Jain');
    expect(row?.textContent).not.toContain('Vegetarian ×1');
  });

  it('searches by name and filters by RSVP', async () => {
    const user = userEvent.setup();
    render(<Harness seed={basePlan} />);
    await user.type(screen.getByLabelText('Search guests'), 'meera');
    expect(screen.getByText('Meera')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search guests'));
    await user.selectOptions(screen.getByLabelText('RSVP'), 'Waiting for reply');
    expect(screen.queryByText('Meera')).toBeNull();
    expect(screen.getByText('No guests match these filters.')).toBeInTheDocument();
  });

  it('raises an allergy alert with text, not colour alone', () => {
    const withAllergy: Plan = run(basePlan, {
      type: 'guest/add',
      id: 'g2',
      name: 'Vikram',
      rsvp: 'yes',
      plusOnes: 0,
      dietary: ['nut_allergy'],
      group: 'Friends',
    });
    render(<Harness seed={withAllergy} />);
    expect(screen.getByText(/1 guest has allergy-related needs/)).toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.className === 'alert' &&
          element.textContent.toLowerCase().includes('nut allergy, gluten-free or dairy-free'),
      ).length,
    ).toBeGreaterThan(0);
  });
});
