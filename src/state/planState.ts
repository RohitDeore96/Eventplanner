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
import {
  capEntries,
  describeAction,
  makeEntry,
  markRedone,
  markReverted,
  type ActivityEntry,
} from './activity';
import type { QuoteStatus } from './quotes';

/**
 * The UI's single source of state: the engine's History wrapped for React. Every change —
 * manual or AI-proposed — goes through applyAction / acceptPatch, so undo always works.
 * The activity log (X9) mirrors the history entries one line each; Undo/Redo flip entries.
 */
export interface PlanState {
  readonly history: History;
  /** Newest-last activity lines, capped; session-only like the undo stack itself. */
  readonly log: readonly ActivityEntry[];
  /** Error from the last rejected action, cleared on the next attempt. The UI renders it inline. */
  readonly lastError: {
    readonly code: string;
    readonly message: string;
    readonly field?: string;
  } | null;
}

export type PlanEvent =
  | { readonly kind: 'apply'; readonly action: PlanAction }
  | {
      readonly kind: 'applyAll';
      readonly actions: readonly PlanAction[];
      readonly label?: string;
      /** Quotation side-effect folded into this batch's undo step (see ActivityEntry.quote). */
      readonly quote?: { readonly id: string; readonly previousStatus: QuoteStatus };
    }
  | { readonly kind: 'patch'; readonly patch: PlanPatch }
  | { readonly kind: 'replace'; readonly plan: Plan }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'clearError' };

const LOG_CAP = 100;

export function initPlanState(plan: Plan): PlanState {
  return { history: initHistory(plan), log: [], lastError: null };
}

function failure(result: Result<unknown>): PlanState['lastError'] {
  return result.ok
    ? null
    : result.error.field === undefined
      ? { code: result.error.code, message: result.error.message }
      : { code: result.error.code, message: result.error.message, field: result.error.field };
}

function withEntry(
  state: PlanState,
  label: string,
  kind: ActivityEntry['kind'],
  quote?: ActivityEntry['quote'],
): PlanState {
  const entry = makeEntry(label, kind, new Date().toISOString(), quote);
  return { ...state, log: capEntries([...state.log, entry], LOG_CAP) };
}

/** Pure state transition, kept out of React so tests need no renderer. */
export function planReducer(state: PlanState, event: PlanEvent, today: string): PlanState {
  const context: ReduceContext = { today };
  switch (event.kind) {
    case 'apply': {
      const before = state.history.present;
      const next = applyAction(state.history, event.action, context);
      if (!next.ok) return { ...state, lastError: failure(next) };
      return withEntry(
        { history: next.value, log: state.log, lastError: null },
        describeAction(event.action, before),
        'single',
      );
    }
    case 'applyAll': {
      // A batch (scenario, accepted quotation) folds into ONE history entry: it either
      // applies in order or nothing changes, and Undo reverses all of it at once.
      const next = applyAllActions(state.history, event.actions, context);
      if (!next.ok) return { ...state, lastError: failure(next) };
      return withEntry(
        { history: next.value, log: state.log, lastError: null },
        event.label ?? `Batch of ${event.actions.length} change(s)`,
        'batch',
        event.quote,
      );
    }
    case 'patch': {
      const next = acceptPatch(state.history, event.patch, context);
      if (!next.ok) return { ...state, lastError: failure(next) };
      return withEntry(
        { history: next.value, log: state.log, lastError: null },
        `AI patch approved — “${event.patch.summary}”`,
        'patch',
      );
    }
    case 'replace':
      return { history: initHistory(event.plan), log: [], lastError: null };
    case 'undo': {
      // `undo()` returns the same history when the stack is empty: a no-op transition must
      // not strike a log line (or move a quotation sidecar) the plan never reverted.
      const history = undo(state.history);
      return history === state.history
        ? state
        : { ...state, history, log: markReverted(state.log), lastError: null };
    }
    case 'redo': {
      // Symmetric: a redo whose step a fresh change cleared is a no-op and must leave the
      // log exactly as it was, so the struck entry cannot look re-applied.
      const history = redo(state.history);
      return history === state.history
        ? state
        : { ...state, history, log: markRedone(state.log), lastError: null };
    }
    case 'clearError':
      return { ...state, lastError: null };
  }
}
