/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { Plan } from '../../src/engine/types';
import { makePlan, run, TODAY } from '../helpers';

function renderView(node: (current: Plan) => React.ReactNode, seed: Plan): PlanAction[] {
  const applied: PlanAction[] = [];

  function Harness(): React.ReactNode {
    const [state, setState] = useState(() => initPlanState(seed));
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
      replace: (next) => {
        setState(initPlanState(next));
      },
      undo: () => {
        setState((currentState: PlanState) => planReducer(currentState, { kind: 'undo' }, TODAY));
      },
      redo: () => {
        setState((currentState: PlanState) => planReducer(currentState, { kind: 'redo' }, TODAY));
      },
    };
    return <PlanContext.Provider value={store}>{node(state.history.present)}</PlanContext.Provider>;
  }

  render(<Harness />);
  return applied;
}
import { App } from '../../src/ui/App';
import { TimelineView } from '../../src/ui/views/TimelineView';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer, type PlanState } from '../../src/state/planState';
import type { PlanAction } from '../../src/engine/actions';
import { patchActionsFromProposal } from '../../src/schemas/patchBridge';
import { planFacts } from '../../src/lib/facts';

const plan: Plan = run(makePlan(), {
  type: 'guest/add',
  id: 'g1',
  name: 'Meera',
  rsvp: 'yes',
  plusOnes: 0,
  dietary: [],
  group: 'Family',
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('patchBridge', () => {
  it('drops undefined optionals so engine actions satisfy exactOptionalPropertyTypes', () => {
    const actions = patchActionsFromProposal({
      summary: 'mixed',
      actions: [
        {
          type: 'task/update',
          id: 't1',
          title: 'Only title',
          dueISO: undefined,
          assignee: undefined,
          done: undefined,
        },
        { type: 'budget/move', fromId: 'a', toId: 'b', amountMinor: 500 },
      ],
    });
    expect(actions).toEqual([
      { type: 'task/update', id: 't1', title: 'Only title' },
      { type: 'budget/move', fromId: 'a', toId: 'b', amountMinor: 500 },
    ]);
  });
});

describe('planFacts', () => {
  it('renders the engine summary as compact text with no invented numbers', () => {
    const facts = planFacts(plan, TODAY);
    expect(facts).toContain('Asha & Dev wedding');
    expect(facts).toContain('catering headcount');
    expect(facts).toContain('done');
  });
});

describe('App shell extras', () => {
  it('offers the demo event before a plan exists and exports after', async () => {
    const stubs: MockInstance[] = [];
    const stubObj: MockInstance = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const stubRevoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const stubClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    stubs.push(stubObj, stubRevoke, stubClick);
    try {
      localStorage.clear();
      render(<App />);
      expect(screen.getByRole('button', { name: 'Load demo event' })).toBeInTheDocument();

      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Event name'), 'Export test');
      await user.type(screen.getByLabelText('Event date'), '2027-08-01');
      await user.type(screen.getByLabelText('Expected guests'), '50');
      await user.type(screen.getByLabelText(/Total budget in/), '200000');
      fireEventSubmit('Create the plan');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Export JSON' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'Export CSV' }));
      await waitFor(() => {
        expect(stubObj).toHaveBeenCalled();
      });
    } finally {
      for (const stub of stubs) {
        stub.mockRestore();
      }
    }
  });
});

describe('TimelineView .ics export', () => {
  it('builds a real calendar file from the plan', async () => {
    const stubClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const stubObj = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ics');
    const stubRevoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    renderView((current) => <TimelineView plan={current} />, plan);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Add timeline to calendar/ }));
    expect(stubClick).toHaveBeenCalled();
    expect(stubObj).toHaveBeenCalled();
    expect(stubRevoke).toHaveBeenCalled();
  });
});

function fireEventSubmit(buttonLabel: string): void {
  const button = screen.getByRole('button', { name: buttonLabel });
  const form = button.closest('form');
  if (form === null) throw new Error('no form');
  const event = new Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
}
