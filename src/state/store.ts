import { createContext, useContext, useReducer } from 'react';
import type { PlanAction } from '../engine/actions';
import { createPlan } from '../engine/create';
import type { Plan } from '../engine/types';
import { initPlanState, planReducer, type PlanEvent, type PlanState } from './planState';

/**
 * The UI's single source of state. Every change — manual or AI-proposed — goes through
 * planReducer (which calls the engine), so undo works everywhere and components never
 * compute money or dates themselves.
 */

/** What the UI needs after a rejected change: the field to highlight and a real message. */
interface ApplyOutcome {
  readonly ok: boolean;
  readonly message: string | null;
  readonly field?: string;
}

export interface Store {
  readonly plan: Plan | null;
  readonly state: PlanState;
  readonly dispatch: (event: PlanEvent) => void;
  /** Applies the action and reports the outcome synchronously (React state updates async). */
  readonly apply: (action: PlanAction) => ApplyOutcome;
  /** Applies a batch as ONE undo step; stops at the first rejection. */
  readonly applyAll: (actions: readonly PlanAction[]) => ApplyOutcome;
  readonly replace: (plan: Plan) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

export const PlanContext = createContext<Store | null>(null);

export function usePlanStore(today: string, initial: Plan | null): Store {
  const [state, dispatch] = useReducer(
    (current: PlanState, event: PlanEvent) => planReducer(current, event, today),
    initial,
    (seed) => initPlanState(seed ?? SENTINEL_PLAN),
  );
  function apply(action: PlanAction): ApplyOutcome {
    const next = planReducer(state, { kind: 'apply', action }, today);
    dispatch({ kind: 'apply', action });
    return next.lastError === null
      ? { ok: true, message: null }
      : { ok: false, message: next.lastError.message, field: next.lastError.field ?? '' };
  }
  function applyAll(actions: readonly PlanAction[]): ApplyOutcome {
    const next = planReducer(state, { kind: 'applyAll', actions }, today);
    dispatch({ kind: 'applyAll', actions });
    return next.lastError === null
      ? { ok: true, message: null }
      : { ok: false, message: next.lastError.message, field: next.lastError.field ?? '' };
  }
  return {
    plan: initial,
    state,
    dispatch,
    apply,
    applyAll,
    replace: (plan) => {
      dispatch({ kind: 'replace', plan });
    },
    undo: () => {
      dispatch({ kind: 'undo' });
    },
    redo: () => {
      dispatch({ kind: 'redo' });
    },
  };
}

export function usePlan(): Store {
  const store = useContext(PlanContext);
  if (store === null) throw new Error('usePlan must be used inside PlanContext');
  return store;
}

/** Never rendered: the store needs a Plan before setup completes. */
const SENTINEL_PLAN: Plan = (() => {
  const created = createPlan(
    {
      id: 'sentinel',
      name: 'Utsav',
      occasion: 'birthday',
      dateISO: '2100-01-01',
      currency: 'INR',
      locale: 'en-IN',
      budgetMinor: 100,
      guestTarget: 1,
    },
    '2100-01-01',
  );
  if (!created.ok) throw new Error('sentinel plan failed');
  return created.value.plan;
})();
