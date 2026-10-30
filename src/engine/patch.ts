import { MAX_PATCH_OPS } from '../config/limits.js';
import type { PlanAction } from './actions.js';
import { budgetTotals } from './budget.js';
import type { ISODate } from './dates.js';
import { reducePlan } from './reducer.js';
import { fail, ok, type Result } from './result.js';
import { comparePlans, type PlanComparison } from './scenario.js';
import type { Plan } from './types.js';
import { computeWarnings, type Warning } from './warnings.js';

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
  /** New or enlarged error-level warnings the patch would cause. A non-empty list blocks acceptance. */
  readonly blockedBy: Warning[];
}

function isAllowed(action: PlanAction): action is PatchAction {
  return (AI_PATCH_ACTION_TYPES as readonly string[]).includes(action.type);
}

/** Shape check before anything touches the plan: patches arrive from the network. */
function checkPatchShape(patch: PlanPatch): Result<null> {
  const raw: unknown = patch;
  if (typeof raw !== 'object' || raw === null) {
    return fail('PATCH_MALFORMED', 'The suggestion is not shaped like a suggestion.');
  }
  const actions: unknown = (raw as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) {
    return fail('PATCH_MALFORMED', 'The suggestion is not shaped like a suggestion.');
  }
  const summary: unknown = (raw as { summary?: unknown }).summary;
  if (typeof summary !== 'string' || summary.length > 500) {
    return fail('PATCH_MALFORMED', 'The suggestion needs a short summary.');
  }
  return ok(null);
}

/**
 * How badly the plan breaks, so a patch cannot enlarge an existing error condition. The
 * magnitude is the rupee overage for money errors plus one per any other error; the id set
 * catches brand-new errors. Both must not grow.
 */
function errorFootprint(
  plan: Plan,
  today: ISODate,
): { ids: ReadonlySet<string>; magnitude: number } {
  const errors = computeWarnings(plan, today).filter((w) => w.severity === 'error');
  const ids = new Set(errors.map((w) => w.id));
  const totals = budgetTotals(plan);
  const magnitude =
    Math.max(0, totals.planned - plan.budgetMinor) +
    Math.max(0, totals.committed - plan.budgetMinor) +
    errors.filter((w) => w.code !== 'OVER_ALLOCATED' && w.code !== 'OVER_COMMITTED').length;
  return { ids, magnitude };
}

/** Applies every action to a copy of the plan and reports the exact impact. Never mutates the input. */
export function dryRunPatch(plan: Plan, patch: PlanPatch, today: ISODate): Result<PatchDryRun> {
  const shape = checkPatchShape(patch);
  if (!shape.ok) return shape;
  if (patch.actions.length === 0) return fail('PATCH_EMPTY', 'The suggestion contains no changes.');
  if (patch.actions.length > MAX_PATCH_OPS) {
    return fail(
      'PATCH_TOO_LARGE',
      `A suggestion can change at most ${MAX_PATCH_OPS} things at once.`,
    );
  }
  let next = plan;
  for (const [index, action] of patch.actions.entries()) {
    const raw: unknown = action;
    if (typeof raw !== 'object' || raw === null || !isAllowed(action))
      return fail(
        'PATCH_ACTION_NOT_ALLOWED',
        `Change ${index + 1} is not something suggestions may do.`,
      );
    const step = reducePlan(next, action, { today });
    if (!step.ok)
      return fail(step.error.code, `Change ${index + 1} cannot be applied: ${step.error.message}`);
    next = step.value;
  }
  const before = errorFootprint(plan, today);
  const after = errorFootprint(next, today);
  const enlarged = after.magnitude > before.magnitude;
  const brandNew = [...after.ids].some((id) => !before.ids.has(id));
  const comparison = comparePlans(plan, next, today);
  const blocking: Warning[] = enlarged || brandNew ? errorWarnings(next, today) : [];
  return ok({ next, comparison, blockedBy: blocking });
}

function errorWarnings(plan: Plan, today: ISODate): Warning[] {
  return computeWarnings(plan, today).filter((w) => w.severity === 'error');
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
