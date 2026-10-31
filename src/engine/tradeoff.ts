import { budgetTotals, categoryFigures } from './budget.js';
import { fail, ok, type Result } from './result.js';
import type { Plan } from './types.js';
import { checkAmount } from './validate.js';

/**
 * Budget trade-off planner (M10.3): the family wants to raise one category's allocation
 * without exceeding the event budget. The planner only PROPOSES — it never mutates a plan.
 * Sources, in a fixed, explainable order:
 *   1. Unallocated budget (budget − sum of all allocations).
 *   2. Locked-category money is never touched.
 *   3. Unlocked categories' slack (planned − committed), largest slack first, so a reduction
 *      never under-funds money already committed to vendors or spent.
 * If those cannot cover the increase, the plan says so honestly instead of inventing money.
 */

interface TradeOffSource {
  readonly categoryId: string;
  readonly name: string;
  /** planned − committed: the most that can move without breaking commitments. */
  readonly slackMinor: number;
  readonly takeMinor: number;
  readonly plannedBefore: number;
  readonly plannedAfter: number;
}

export interface TradeOffPlan {
  readonly toCategoryId: string;
  readonly toName: string;
  readonly increaseMinor: number;
  readonly unallocatedBefore: number;
  readonly unallocatedAfter: number;
  readonly sources: readonly TradeOffSource[];
  /** > 0 when unallocated + slack could not cover the increase. */
  readonly shortfallMinor: number;
  readonly plannedBefore: number;
  readonly plannedAfter: number;
}

export function tradeOffFor(
  plan: Plan,
  toCategoryId: string,
  increaseMinor: number,
): Result<TradeOffPlan> {
  const amount = checkAmount(increaseMinor, 'increaseMinor', 'Increase');
  if (!amount.ok) return amount;
  if (increaseMinor === 0) {
    return fail('INVALID_AMOUNT', 'The increase must be more than zero.', 'increaseMinor');
  }
  const target = plan.categories.find((c) => c.id === toCategoryId);
  if (!target) return fail('CATEGORY_NOT_FOUND', 'That category no longer exists.', 'toCategoryId');
  if (target.locked) {
    return fail(
      'CATEGORY_LOCKED',
      `${target.name} is locked — unlock it before changing its allocation.`,
      'toCategoryId',
    );
  }

  const totals = budgetTotals(plan);
  const unallocated = totals.budget - totals.planned;
  const need = increaseMinor;
  const fromUnallocated = Math.min(Math.max(unallocated, 0), need);
  let remaining = need - fromUnallocated;

  const givers = plan.categories
    .filter((c) => c.id !== toCategoryId && !c.locked)
    .map((c) => ({ category: c, slack: c.plannedMinor - categoryFigures(plan, c).committed }))
    .filter((row) => row.slack > 0)
    .sort((a, b) => b.slack - a.slack);

  const sources: TradeOffSource[] = [];
  for (const row of givers) {
    if (remaining <= 0) break;
    const take = Math.min(row.slack, remaining);
    remaining -= take;
    sources.push({
      categoryId: row.category.id,
      name: row.category.name,
      slackMinor: row.slack,
      takeMinor: take,
      plannedBefore: row.category.plannedMinor,
      plannedAfter: row.category.plannedMinor - take,
    });
  }

  return ok({
    toCategoryId: target.id,
    toName: target.name,
    increaseMinor,
    unallocatedBefore: unallocated,
    unallocatedAfter: unallocated - fromUnallocated,
    sources,
    shortfallMinor: remaining,
    plannedBefore: target.plannedMinor,
    plannedAfter: target.plannedMinor + increaseMinor,
  });
}

/** The engine actions that execute an approved trade-off, in one undoable batch.
 *  Empty when the proposal still has a shortfall: the planner never emits actions that
 *  would break the budget — the UI shows the shortfall instead and offers no Apply. */
export function tradeOffActions(proposal: TradeOffPlan): PlanTradeOffActions[] {
  if (proposal.shortfallMinor > 0) return [];
  const actions: PlanTradeOffActions[] = [];
  if (proposal.increaseMinor > 0) {
    actions.push({
      type: 'category/update',
      id: proposal.toCategoryId,
      plannedMinor: proposal.plannedAfter,
    });
  }
  for (const source of proposal.sources) {
    if (source.takeMinor > 0) {
      actions.push({
        type: 'category/update',
        id: source.categoryId,
        plannedMinor: source.plannedAfter,
      });
    }
  }
  return actions;
}

// Local alias keeps the import list honest: the actions are exactly the engine's own.
import type { PlanAction } from './actions.js';
export type PlanTradeOffActions = Extract<PlanAction, { type: 'category/update' }>;
