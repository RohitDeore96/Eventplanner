/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer } from '../../src/state/planState';
import { applyAllActions } from '../../src/engine/history';
import { makePlan, run, TODAY, catId } from '../helpers';
import { buildDemoPlan } from '../../src/state/demo';
import { useState } from 'react';
import { ScenarioPanel } from '../../src/ui/views/ScenarioPanel';
import type { Plan } from '../../src/engine/types';

/**
 * X2 UI acceptance: preview never mutates the real plan; only pressing Apply changes it,
 * and the change is reversible with Undo.
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
    applyAll: (actions) => {
      const next = applyAllActions(state.history, actions, { today: TODAY });
      if (next.ok) {
        setState({ ...state, history: next.value, lastError: null });
        return { ok: true, message: null };
      }
      return { ok: false, message: next.error.message, field: next.error.field ?? '' };
    },
    replace: () => undefined,
    undo: () => {
      setState(planReducer(state, { kind: 'undo' }, TODAY));
    },
    redo: () => {
      setState(planReducer(state, { kind: 'redo' }, TODAY));
    },
  };
  return (
    <PlanContext.Provider value={store}>
      <ScenarioPanel plan={state.history.present} />
      <p data-testid="budget-now">Budget now: {state.history.present.budgetMinor}</p>
      <button type="button" onClick={store.undo}>
        Undo
      </button>
    </PlanContext.Provider>
  );
}

describe('scenario panel (X2 UI)', () => {
  it('previews on a copy, discards without touching the plan, then applies on approval', async () => {
    const user = userEvent.setup();
    render(<Harness seed={makePlan()} />);

    // Choose "Budget −15%" and preview.
    await user.click(screen.getByRole('radio', { name: /Budget −15%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    const preview = screen.getByText(/simulated — not applied/);
    expect(preview).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Budget: −/)).toBeInTheDocument();
    });

    // The real plan is untouched while previewing.
    expect(screen.getByTestId('budget-now').textContent).toContain(
      `Budget now: ${makePlan().budgetMinor}`,
    );

    // Discard: still untouched.
    await user.click(screen.getByRole('button', { name: 'Discard preview' }));
    expect(screen.queryByText(/simulated — not applied/)).toBeNull();
    expect(screen.getByTestId('budget-now').textContent).toContain(
      `Budget now: ${makePlan().budgetMinor}`,
    );

    // Preview again and apply for real.
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await user.click(screen.getByRole('button', { name: 'Apply this scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Scenario applied/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('budget-now').textContent).not.toContain(
      `Budget now: ${makePlan().budgetMinor}`,
    );
  });

  it('warns instead of applying when a scenario is impossible for the plan', async () => {
    const user = userEvent.setup();
    // An event already within 14 days of today cannot move closer.
    render(<Harness seed={makePlan({ dateISO: TODAY })} />);
    await user.click(screen.getByRole('radio', { name: /Event 14 days closer/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      const alert = screen.getByRole('status');
      expect(alert.textContent.length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/simulated — not applied/)).toBeNull();
  });
});

describe('scenario panel coverage extras', () => {
  it('shows committed and task-reschedule lines for vendor and date scenarios', async () => {
    const user = userEvent.setup();
    const wedding = buildDemoPlan(TODAY);
    if (wedding === null) throw new Error('demo plan failed');
    render(<Harness seed={wedding} />);
    await user.click(screen.getByRole('radio', { name: /Vendor prices \+10%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Committed:/).length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole('button', { name: 'Discard preview' }));
    await user.click(screen.getByRole('radio', { name: /Event 14 days closer/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getAllByText(/task\(s\) rescheduled/).length).toBeGreaterThan(0);
    });
  });

  it('says when a scenario would not change anything measurable', async () => {
    const user = userEvent.setup();
    // A plan with no booked vendors: vendor +10% has nothing to raise.
    const noVendors = makePlan();
    render(<Harness seed={noVendors} />);
    await user.click(screen.getByRole('radio', { name: /Vendor prices \+10%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getAllByText(/No measurable change/).length).toBeGreaterThan(0);
    });
  });
});

describe('stress test panel (X6 UI)', () => {
  it('runs the combined shocks, shows the verdict, and applies as one undo step', async () => {
    const user = userEvent.setup();
    render(<Harness seed={makePlan()} />);

    await user.click(screen.getByRole('button', { name: 'Run stress test' }));
    await waitFor(() => {
      expect(screen.getByText(/The plan survives/)).toBeInTheDocument();
    });
    expect(screen.getByText(/simulated — not applied/)).toBeInTheDocument();
    expect(screen.getByText(/Guests: 120 → 144/)).toBeInTheDocument();

    // The plan is untouched while the result is on screen.
    expect(screen.getByTestId('budget-now').textContent).toContain(
      `Budget now: ${makePlan().budgetMinor}`,
    );

    await user.click(screen.getByRole('button', { name: 'Apply stress scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Stress scenario applied/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('budget-now').textContent).not.toContain(
      `Budget now: ${makePlan().budgetMinor}`,
    );

    // One undo step reverses the whole combined shock.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('budget-now').textContent).toContain(
      `Budget now: ${makePlan().budgetMinor}`,
    );
  });

  it('tells the truth when the shocks break the plan', async () => {
    const user = userEvent.setup();
    const tight = makePlan({ budgetMinor: 10_000_000 });
    const committed = run(tight, {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(tight, 'venue'),
      name: 'Grand Hall',
      contactNote: '',
      status: 'booked',
      committedMinor: 9_500_000,
    });
    render(<Harness seed={committed} />);
    await user.click(screen.getByRole('button', { name: 'Run stress test' }));
    await waitFor(() => {
      expect(screen.getByText(/The plan breaks/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Over budget by:/)).toBeInTheDocument();
  });
});
