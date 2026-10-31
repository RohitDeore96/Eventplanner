/** @vitest-environment jsdom */
import { useState } from 'react';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer, type PlanState } from '../../src/state/planState';
import { applyAction } from '../../src/engine/history';
import type { Plan } from '../../src/engine/types';
import { TODAY } from '../helpers';

/**
 * Shared UI test harness: the real planReducer behind PlanContext, so any view under test
 * behaves exactly like it does inside the App shell (including undo and error messages).
 */
export function Harness({
  seed,
  children,
}: {
  seed: Plan;
  children: (plan: Plan) => React.ReactNode;
}): React.ReactNode {
  const [state, setState] = useState<PlanState>(() => initPlanState(seed));
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
    replace: (plan: Plan) => {
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
    <PlanContext.Provider value={store}>{children(state.history.present)}</PlanContext.Provider>
  );
}

/** Submits the closest form around a field, as the browser would on a submit button. */
export function fireEventSubmit(field: HTMLElement): void {
  const form = field.closest('form');
  if (form === null) throw new Error('no form');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}
