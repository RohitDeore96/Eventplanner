import { MAX_HISTORY } from '../config/limits.js';
import type { PlanAction, ReduceContext } from './actions.js';
import { applyPatch, type PlanPatch } from './patch.js';
import { reducePlan } from './reducer.js';
import { ok, type Result } from './result.js';
import type { Plan } from './types.js';

export interface History {
  readonly past: readonly Plan[];
  readonly present: Plan;
  readonly future: readonly Plan[];
}

export function initHistory(plan: Plan): History {
  return { past: [], present: plan, future: [] };
}

function push(history: History, next: Plan): History {
  const past = [...history.past, history.present].slice(-MAX_HISTORY);
  return { past, present: next, future: [] };
}

export function applyAction(
  history: History,
  action: PlanAction,
  context: ReduceContext,
): Result<History> {
  const next = reducePlan(history.present, action, context);
  return next.ok ? ok(push(history, next.value)) : next;
}

/**
 * A batch of actions (scenario, accepted quotation) folds into ONE undo step, however
 * many actions it contains: either every action applies in order, or nothing changes.
 */
export function applyAllActions(
  history: History,
  actions: readonly PlanAction[],
  context: ReduceContext,
): Result<History> {
  let present = history.present;
  for (const action of actions) {
    const next = reducePlan(present, action, context);
    if (!next.ok) return next;
    present = next.value;
  }
  return ok(push(history, present));
}

/** An accepted AI patch is one undo step, however many actions it contains. */
export function acceptPatch(
  history: History,
  patch: PlanPatch,
  context: ReduceContext,
): Result<History> {
  const next = applyPatch(history.present, patch, context.today);
  return next.ok ? ok(push(history, next.value)) : next;
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
