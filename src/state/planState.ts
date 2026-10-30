import type { PlanAction, ReduceContext } from '../engine/actions';
import {
  acceptPatch,
  applyAction,
  applyAllActions,
  initHistory,
  redo,
  undo,
  type History,
} from '../engine/history';
import type { PlanPatch } from '../engine/patch';
import type { Plan } from '../engine/types';
import type { Result } from '../engine/result';

/**
 * The UI's single source of state: the engine's History wrapped for React. Every change —
 * manual or AI-proposed — goes through applyAction / acceptPatch, so undo always works.
 */
export interface PlanState {
  readonly history: History;
  /** Error from the last rejected action, cleared on the next attempt. The UI renders it inline. */
  readonly lastError: {
    readonly code: string;
    readonly message: string;
    readonly field?: string;
  } | null;
}

export type PlanEvent =
  | { readonly kind: 'apply'; readonly action: PlanAction }
  | { readonly kind: 'applyAll'; readonly actions: readonly PlanAction[] }
  | { readonly kind: 'patch'; readonly patch: PlanPatch }
  | { readonly kind: 'replace'; readonly plan: Plan }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'clearError' };

export function initPlanState(plan: Plan): PlanState {
  return { history: initHistory(plan), lastError: null };
}

function failure(result: Result<unknown>): PlanState['lastError'] {
  return result.ok
    ? null
    : result.error.field === undefined
      ? { code: result.error.code, message: result.error.message }
      : { code: result.error.code, message: result.error.message, field: result.error.field };
}

/** Pure state transition, kept out of React so tests need no renderer. */
export function planReducer(state: PlanState, event: PlanEvent, today: string): PlanState {
  const context: ReduceContext = { today };
  switch (event.kind) {
    case 'apply': {
      const next = applyAction(state.history, event.action, context);
      return next.ok
        ? { history: next.value, lastError: null }
        : { ...state, lastError: failure(next) };
    }
    case 'applyAll': {
      // A batch (scenario, accepted quotation) folds into ONE history entry: it either
      // applies in order or nothing changes, and Undo reverses all of it at once.
      const next = applyAllActions(state.history, event.actions, context);
      return next.ok
        ? { history: next.value, lastError: null }
        : { ...state, lastError: failure(next) };
    }
    case 'patch': {
      const next = acceptPatch(state.history, event.patch, context);
      return next.ok
        ? { history: next.value, lastError: null }
        : { ...state, lastError: failure(next) };
    }
    case 'replace':
      return { history: initHistory(event.plan), lastError: null };
    case 'undo':
      return { ...state, history: undo(state.history), lastError: null };
    case 'redo':
      return { ...state, history: redo(state.history), lastError: null };
    case 'clearError':
      return { ...state, lastError: null };
  }
}
