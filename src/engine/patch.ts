import { MAX_PATCH_OPS } from '../config/limits';
import type { PlanAction } from './actions';
import type { ISODate } from './dates';
import { reducePlan } from './reducer';
import { fail, ok, type Result } from './result';
import { comparePlans, type PlanComparison } from './scenario';
import type { Plan } from './types';
import type { Warning } from './warnings';

/** Actions an AI patch may contain. Everything else (deletes, vendors, expenses, guests) is manual only. */
const AI_PATCH_ACTION_TYPES = [
  'task/add',
  'task/update',
  'task/delay',
  'budget/move',
  'category/add',
] as const;

export type PatchAction = Extract<PlanAction, { type: (typeof AI_PATCH_ACTION_TYPES)[number] }>;

export interface PlanPatch {
  readonly summary: string;
  readonly actions: readonly PatchAction[];
}

export interface PatchDryRun {
  readonly next: Plan;
  readonly comparison: PlanComparison;
  /** New error-level warnings the patch would introduce. A non-empty list blocks acceptance. */
  readonly blockedBy: Warning[];
}

function isAllowed(action: PlanAction): action is PatchAction {
  return (AI_PATCH_ACTION_TYPES as readonly string[]).includes(action.type);
}

/** Applies every action to a copy of the plan and reports the exact impact. Never mutates the input. */
export function dryRunPatch(plan: Plan, patch: PlanPatch, today: ISODate): Result<PatchDryRun> {
  if (patch.actions.length === 0) return fail('PATCH_EMPTY', 'The suggestion contains no changes.');
  if (patch.actions.length > MAX_PATCH_OPS) {
    return fail(
      'PATCH_TOO_LARGE',
      `A suggestion can change at most ${MAX_PATCH_OPS} things at once.`,
    );
  }
  let next = plan;
  for (const [index, action] of patch.actions.entries()) {
    if (!isAllowed(action))
      return fail(
        'PATCH_ACTION_NOT_ALLOWED',
        `Change ${index + 1} is not something suggestions may do.`,
      );
    const step = reducePlan(next, action, { today });
    if (!step.ok)
      return fail(step.error.code, `Change ${index + 1} cannot be applied: ${step.error.message}`);
    next = step.value;
  }
  const comparison = comparePlans(plan, next, today);
  return ok({
    next,
    comparison,
    blockedBy: comparison.newWarnings.filter((w) => w.severity === 'error'),
  });
}

/** Returns the new plan only when the dry run is clean. */
export function applyPatch(plan: Plan, patch: PlanPatch, today: ISODate): Result<Plan> {
  const dry = dryRunPatch(plan, patch, today);
  if (!dry.ok) return dry;
  return dry.value.blockedBy.length > 0
    ? fail(
        'PATCH_BREAKS_PLAN',
        `This suggestion would cause a problem: ${dry.value.blockedBy[0]?.message ?? 'a plan error'}`,
      )
    : ok(dry.value.next);
}
