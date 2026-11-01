import type { PlanAction } from '../../../engine/actions';
import { parseMajorAmount } from '../../../engine/money';
import { reducePlan } from '../../../engine/reducer';
import { ok, type Result } from '../../../engine/result';
import type { PlanComparison } from '../../../engine/scenario';
import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';

/**
 * Pure preview helpers for the what-if panel: they turn a plan comparison into the exact
 * lines the panel shows, parse the family's own assumptions, and run actions on a COPY of
 * the plan. Nothing here touches the real plan or the store — previews cannot mutate it.
 */

/** One signed money delta, e.g. "+₹5,000" / "−₹500". */
export function deltaLabel(value: number, plan: Plan): string {
  return `${value >= 0 ? '+' : '−'}${money(Math.abs(value), plan)}`;
}

/** Task/warning delta lines shared by the built-in and custom scenario previews. */
export function comparisonChangeLines(comparison: PlanComparison): string[] {
  const lines: string[] = [];
  if (comparison.tasksRescheduled.length > 0) {
    lines.push(`${comparison.tasksRescheduled.length} task(s) rescheduled`);
  }
  if (comparison.newWarnings.length > 0) {
    lines.push(`${comparison.newWarnings.length} new warning(s) would appear`);
  }
  if (comparison.resolvedWarnings.length > 0) {
    lines.push(`${comparison.resolvedWarnings.length} warning(s) would clear`);
  }
  return lines;
}

/** The preview lines for a built-in scenario; identical wording to the inline original. */
export function scenarioPreviewLines(plan: Plan, comparison: PlanComparison): string[] {
  const lines: string[] = [];
  if (comparison.budgetDelta !== 0)
    lines.push(`Budget: ${deltaLabel(comparison.budgetDelta, plan)}`);
  if (comparison.committedDelta !== 0) {
    lines.push(`Committed: ${deltaLabel(comparison.committedDelta, plan)}`);
  }
  // Cash still to pay = committed − paid, so its delta is the difference of the two deltas.
  const cashDelta = comparison.committedDelta - comparison.paidDelta;
  if (cashDelta !== 0) lines.push(`Cash still to pay: ${deltaLabel(cashDelta, plan)}`);
  if (comparison.guestTargetDelta !== 0) {
    lines.push(
      `Guest target: ${comparison.guestTargetDelta > 0 ? '+' : ''}${comparison.guestTargetDelta}`,
    );
  }
  const categoryChanges = comparison.categories.filter((c) => c.plannedBefore !== c.plannedAfter);
  for (const change of categoryChanges.slice(0, 6)) {
    lines.push(
      `${change.name}: ${money(change.plannedBefore, plan)} → ${money(change.plannedAfter, plan)}`,
    );
  }
  lines.push(...comparisonChangeLines(comparison));
  if (lines.length === 0)
    lines.push('No measurable change — this scenario does not apply to the plan as it stands.');
  return lines;
}

/** The preview lines for the family's own guest/budget assumptions. */
export function customPreviewLines(
  plan: Plan,
  comparison: PlanComparison,
  guestTargetAfter: number,
): string[] {
  const lines: string[] = [];
  if (comparison.budgetDelta !== 0)
    lines.push(`Budget: ${deltaLabel(comparison.budgetDelta, plan)}`);
  if (comparison.guestTargetDelta !== 0) {
    lines.push(
      `Guest target: ${plan.guestTarget} → ${guestTargetAfter} (${comparison.guestTargetDelta > 0 ? '+' : ''}${comparison.guestTargetDelta})`,
    );
  }
  if (comparison.committedDelta !== 0)
    lines.push(`Committed: ${deltaLabel(comparison.committedDelta, plan)}`);
  lines.push(...comparisonChangeLines(comparison));
  return lines;
}

/** The guest input: undefined when left blank, null when invalid, else the whole count. */
export function parseGuestsInput(guestsText: string): number | null | undefined {
  const raw = guestsText.trim();
  if (raw.length === 0) return undefined;
  const value: unknown = Number(raw);
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : null;
}

/** The budget input: undefined when left blank, null when unparsable, else minor units. */
export function parseBudgetInput(plan: Plan, budgetText: string): number | null | undefined {
  const raw = budgetText.trim();
  if (raw.length === 0) return undefined;
  return parseMajorAmount(raw, plan.currency);
}

/** Builds the engine actions for the family's own guest/budget assumptions; null when invalid. */
export function customScenarioActions(
  plan: Plan,
  guestsText: string,
  budgetText: string,
): PlanAction[] | null {
  const guests = parseGuestsInput(guestsText);
  const budget = parseBudgetInput(plan, budgetText);
  if (guests === null || budget === null) return null;
  if (guests === undefined && budget === undefined) return [];
  const changes: { guestTarget?: number; budgetMinor?: number } = {};
  if (guests !== undefined) changes.guestTarget = guests;
  if (budget !== undefined) changes.budgetMinor = budget;
  if (changes.guestTarget === plan.guestTarget && changes.budgetMinor === plan.budgetMinor) {
    return [];
  }
  return [{ type: 'event/update', changes }];
}

/** Runs actions on a COPY for preview; the real plan is only touched by Apply. */
export function reducePlanCopy(
  plan: Plan,
  actions: readonly PlanAction[],
  today: string,
): Result<Plan> {
  let current = plan;
  for (const action of actions) {
    const next = reducePlan(current, action, { today });
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(current);
}
