/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { PlanContext, type Store } from '../../src/state/store';
import type { PlanState } from '../../src/state/planState';
import { initPlanState, planReducer } from '../../src/state/planState';
import { applyAction } from '../../src/engine/history';
import type { PlanAction } from '../../src/engine/actions';
import { makePlan, run, TODAY } from '../helpers';
import type { Plan } from '../../src/engine/types';
import { BudgetView } from '../../src/ui/views/BudgetView';
import { GuestsView } from '../../src/ui/views/GuestsView';
import { TimelineView } from '../../src/ui/views/TimelineView';
import { VendorsView } from '../../src/ui/views/VendorsView';

const plan = run(makePlan(), {
  type: 'guest/add',
  id: 'g1',
  name: 'Meera',
  rsvp: 'yes',
  plusOnes: 1,
  dietary: ['vegetarian'],
  group: 'Family',
});

function renderView(node: (current: Plan) => React.ReactNode, seed: Plan): PlanAction[] {
  const applied: PlanAction[] = [];

  function Harness(): React.ReactNode {
    const [state, setState] = useState<PlanState>(() => initPlanState(seed));
    const store: Store = {
      plan: seed,
      state,
      dispatch: () => undefined,
      apply: (action) => {
        applied.push(action);
        const next = planReducer(state, { kind: 'apply', action }, TODAY);
        setState(next);
        return next.lastError === null
          ? { ok: true, message: null }
          : { ok: false, message: next.lastError.message, field: next.lastError.field ?? '' };
      },
      applyAll: (actions) => {
        let rolling = state.history;
        for (const action of actions) {
          const next = applyAction(rolling, action, { today: TODAY });
          if (!next.ok) {
            return { ok: false, message: next.error.message, field: next.error.field ?? '' };
          }
          rolling = next.value;
        }
        setState({ history: rolling, lastError: null });
        return { ok: true, message: null };
      },
      replace: (next) => {
        setState(initPlanState(next));
      },
      undo: () => {
        setState((s) => planReducer(s, { kind: 'undo' }, TODAY));
      },
      redo: () => {
        setState((s) => planReducer(s, { kind: 'redo' }, TODAY));
      },
    };
    return <PlanContext.Provider value={store}>{node(state.history.present)}</PlanContext.Provider>;
  }

  render(<Harness />);
  return applied;
}

describe('BudgetView', () => {
  it('shows planned, committed, paid and remaining per category', () => {
    renderView((current) => <BudgetView plan={current} />, plan);
    expect(screen.getByRole('columnheader', { name: 'Planned' })).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
  });

  it('moves money between categories through the engine', async () => {
    const applied = renderView((current) => <BudgetView plan={current} />, plan);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Amount to move'), '1000');
    submit('Move');
    expect(applied.some((action) => action.type === 'budget/move')).toBe(true);
  });

  it('logs an expense and lists it with a delete control', async () => {
    renderView((current) => <BudgetView plan={current} />, plan);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Amount spent'), '2500');
    await user.type(screen.getByLabelText('Date'), '2026-11-01');
    await user.type(screen.getByLabelText('Note (optional)'), 'tokens');
    submit('Add expense');
    await waitFor(() => {
      expect(screen.getAllByText('tokens').length).toBeGreaterThan(0);
    });
  });

  it('has no axe violations', async () => {
    renderView((current) => <BudgetView plan={current} />, plan);
    const results = await axe(document.body);
    expect(results.violations).toHaveLength(0);
  });
});

describe('TimelineView', () => {
  it('lists generated milestones with status badges', () => {
    renderView((current) => <TimelineView plan={current} />, plan);
    expect(screen.getByRole('columnheader', { name: 'Due' })).toBeInTheDocument();
  });

  it('marks a task done and delays a task through the engine', async () => {
    const applied = renderView((current) => <TimelineView plan={current} />, plan);
    const user = userEvent.setup();
    const doneButton = screen.getAllByRole('button', { name: 'Done' }).at(0);
    if (doneButton === undefined) throw new Error('no Done button');
    await user.click(doneButton);
    expect(applied.some((a) => a.type === 'task/update')).toBe(true);
    const delayButton = screen.getAllByRole('button', { name: 'Delay 7d' }).at(0);
    if (delayButton === undefined) throw new Error('no Delay button');
    await user.click(delayButton);
    expect(applied.some((a) => a.type === 'task/delay')).toBe(true);
  });

  it('adds a custom task', async () => {
    const applied = renderView((current) => <TimelineView plan={current} />, plan);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('What needs doing'), 'Book mehndi artist');
    await user.type(screen.getByLabelText('Due date'), '2027-01-15');
    submit('Add task');
    expect(applied.some((a) => a.type === 'task/add')).toBe(true);
  });

  it('has no axe violations', async () => {
    renderView((current) => <TimelineView plan={current} />, plan);
    const results = await axe(document.body);
    expect(results.violations).toHaveLength(0);
  });
});

describe('GuestsView', () => {
  it('shows the catering requirement from the engine', () => {
    renderView((current) => <GuestsView plan={current} />, plan);
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent.includes('people to cater for') ?? false,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/vegetarian/i).length).toBeGreaterThan(0);
  });

  it('adds a guest, changes RSVP and removes a guest', async () => {
    const applied = renderView((current) => <GuestsView plan={current} />, plan);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'Rohan');
    submit('Add guest');
    expect(applied.some((a) => a.type === 'guest/add')).toBe(true);
    fireEvent.change(screen.getByLabelText('RSVP for Meera'), { target: { value: 'yes' } });
    expect(applied.some((a) => a.type === 'guest/update')).toBe(true);
    const removeButton = screen.getAllByRole('button', { name: 'Remove' }).at(0);
    if (removeButton === undefined) throw new Error('no Remove button');
    await user.click(removeButton);
    expect(applied.some((a) => a.type === 'guest/delete')).toBe(true);
  });

  it('has no axe violations', async () => {
    renderView((current) => <GuestsView plan={current} />, plan);
    const results = await axe(document.body);
    expect(results.violations).toHaveLength(0);
  });
});

describe('VendorsView', () => {
  it('shows the per-occasion booking checklist', () => {
    renderView((current) => <VendorsView plan={current} />, plan);
    expect(screen.getByText('Booking checklist')).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) => element?.textContent.includes('Not started') ?? false)
        .length,
    ).toBeGreaterThan(0);
  });

  it('adds a vendor with status and price', async () => {
    const applied = renderView((current) => <VendorsView plan={current} />, plan);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Vendor name'), 'Grand Hall');
    await user.type(screen.getByLabelText('Agreed price (only for booked)'), '300000');
    submit('Add vendor');
    expect(applied.some((a) => a.type === 'vendor/add')).toBe(true);
  });

  it('has no axe violations', async () => {
    renderView((current) => <VendorsView plan={current} />, plan);
    const results = await axe(document.body);
    expect(results.violations).toHaveLength(0);
  });
});

function submit(buttonLabel: string): void {
  const button = screen.getByRole('button', { name: buttonLabel });
  const form = button.closest('form');
  if (form === null) throw new Error(`no form for ${buttonLabel}`);
  fireEvent.submit(form);
}
