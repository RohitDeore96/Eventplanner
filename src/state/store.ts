import { createContext, useContext, useReducer } from 'react';
import type { PlanAction } from '../engine/actions';
import { createPlan } from '../engine/create';
import type { Plan } from '../engine/types';
import { initPlanState, planReducer, type PlanEvent, type PlanState } from './planState';
import { setQuoteStatus, type QuoteStatus } from './quotes';
import type { ActivityEntry } from './activity';

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
  /** Applies a batch as ONE undo step; stops at the first rejection. An accepted
   * quotation passes its quote reference so Undo can revert the sidecar status too. */
  readonly applyAll: (
    actions: readonly PlanAction[],
    label?: string,
    quote?: { readonly id: string; readonly previousStatus: QuoteStatus },
  ) => ApplyOutcome;
  readonly replace: (plan: Plan) => void;
  readonly undo: () => void;
  readonly redo: () => void;
}

export const PlanContext = createContext<Store | null>(null);

/**
 * Quotation sidecar coupling for Undo/Redo: an accepted quotation books the vendor in the
 * plan AND marks the quote 'accepted' in the sidecar library. Both are reverted together —
 * Undo finds the batch entry carrying the quote reference and restores the previous status;
 * Redo re-applies 'accepted'. Without this, Undo un-booked the vendor while the accepted
 * badge stayed, and that status guard then blocked the quote from ever being re-accepted.
 * Best-effort by design: a quote deleted in the meantime simply cannot be reverted.
 */
function revertEntryQuote(log: readonly ActivityEntry[]): void {
  const target = [...log].reverse().find((entry) => !entry.reverted);
  if (target?.quote !== undefined) setQuoteStatus(target.quote.id, target.quote.previousStatus);
}

function reapplyEntryQuote(log: readonly ActivityEntry[]): void {
  const target = [...log].reverse().find((entry) => entry.reverted);
  if (target?.quote !== undefined) setQuoteStatus(target.quote.id, 'accepted');
}

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
  function applyAll(
    actions: readonly PlanAction[],
    label?: string,
    quote?: { readonly id: string; readonly previousStatus: QuoteStatus },
  ): ApplyOutcome {
    const event: PlanEvent =
      label === undefined && quote === undefined
        ? { kind: 'applyAll', actions }
        : {
            kind: 'applyAll',
            actions,
            ...(label !== undefined ? { label } : {}),
            ...(quote !== undefined ? { quote } : {}),
          };
    const next = planReducer(state, event, today);
    dispatch(event);
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
      // The sidecar may only move when the plan transition actually succeeds: run the same
      // pure reducer first and act only when the history moved. A no-op undo — like a redo
      // whose step a fresh change cleared — must leave the quotation status alone, or a
      // quote could end up "accepted" without the vendor booking it stands for.
      const next = planReducer(state, { kind: 'undo' }, today);
      if (next.history !== state.history) revertEntryQuote(state.log);
      dispatch({ kind: 'undo' });
    },
    redo: () => {
      const next = planReducer(state, { kind: 'redo' }, today);
      if (next.history !== state.history) reapplyEntryQuote(state.log);
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
