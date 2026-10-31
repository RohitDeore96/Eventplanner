import { useMemo, useState } from 'react';
import type { PlanAction } from '../../engine/actions';
import { parseMajorAmount } from '../../engine/money';
import { reducePlan } from '../../engine/reducer';
import { ok, type Result } from '../../engine/result';
import {
  comparePlans,
  buildScenario,
  SCENARIOS,
  scenarioActions,
  stressTest,
  stressTestActions,
  STRESS_SPEC,
  type ScenarioId,
  type StressReport,
} from '../../engine/scenario';
import type { Plan } from '../../engine/types';
import { localToday, money } from '../../lib/format';
import { usePlan } from '../../state/store';

/**
 * What-if scenarios (X2): pick a pressure, PREVIEW its exact impact on a copy of the plan,
 * and only apply on an explicit approval. The preview can never mutate the real plan; apply
 * runs the same engine actions the family could have done by hand, so undo reverses it.
 */
export function ScenarioPanel({ plan }: { plan: Plan }): React.ReactNode {
  const store = usePlan();
  const today = useMemo(() => localToday(), []);
  const [selected, setSelected] = useState<ScenarioId | null>(null);
  const [preview, setPreview] = useState<{ headline: string; lines: readonly string[] } | null>(
    null,
  );
  const [stress, setStress] = useState<StressReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Custom scenario (M12.1): the family's own assumptions — new guest count and/or budget.
  const [customGuests, setCustomGuests] = useState(String(plan.guestTarget));
  const [customBudget, setCustomBudget] = useState(
    String(Math.round(plan.budgetMinor / 10 ** (plan.currency === 'JPY' ? 0 : 2))),
  );

  const spec = SCENARIOS.find((s) => s.id === selected) ?? null;

  function showPreview(): void {
    if (selected === null) return;
    const after = buildScenario(plan, selected, today);
    if (!after.ok) {
      setPreview(null);
      setNotice(after.error.message);
      return;
    }
    const comparison = comparePlans(plan, after.value, today);
    const lines: string[] = [];
    const delta = (value: number): string =>
      `${value >= 0 ? '+' : '−'}${money(Math.abs(value), plan)}`;
    if (comparison.budgetDelta !== 0) lines.push(`Budget: ${delta(comparison.budgetDelta)}`);
    if (comparison.committedDelta !== 0) {
      lines.push(`Committed: ${delta(comparison.committedDelta)}`);
    }
    // Cash still to pay = committed − paid, so its delta is the difference of the two deltas.
    const cashDelta = comparison.committedDelta - comparison.paidDelta;
    if (cashDelta !== 0) lines.push(`Cash still to pay: ${delta(cashDelta)}`);
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
    if (comparison.tasksRescheduled.length > 0) {
      lines.push(`${comparison.tasksRescheduled.length} task(s) rescheduled`);
    }
    if (comparison.newWarnings.length > 0) {
      lines.push(`${comparison.newWarnings.length} new warning(s) would appear`);
    }
    if (comparison.resolvedWarnings.length > 0) {
      lines.push(`${comparison.resolvedWarnings.length} warning(s) would clear`);
    }
    if (lines.length === 0)
      lines.push('No measurable change — this scenario does not apply to the plan as it stands.');
    setPreview({ headline: spec?.label ?? 'Scenario', lines });
    setNotice(null);
  }

  function apply(): void {
    if (selected === null) return;
    const actions = scenarioActions(plan, selected);
    if (actions.length === 0) {
      setNotice('Nothing to apply — this scenario does not change the plan.');
      return;
    }
    const outcome = store.applyAll(actions, `What-if scenario: ${spec?.label ?? selected}`);
    setPreview(null);
    setNotice(
      outcome.ok
        ? 'Scenario applied as one undo step — use Undo in the header to reverse it.'
        : (outcome.message ?? 'The scenario could not be applied.'),
    );
  }

  function showCustomPreview(): void {
    const actions = customScenarioActions(plan, customGuests, customBudget);
    if (actions === null) {
      setNotice('Enter a whole guest count of 1 or more, and/or a budget amount.');
      setPreview(null);
      return;
    }
    if (actions.length === 0) {
      setNotice('Nothing would change — the values match the plan as it stands.');
      setPreview(null);
      return;
    }
    const after = reducePlanCopy(plan, actions, today);
    if (!after.ok) {
      setNotice(after.error.message);
      setPreview(null);
      return;
    }
    const comparison = comparePlans(plan, after.value, today);
    const lines: string[] = [];
    const delta = (value: number): string =>
      `${value >= 0 ? '+' : '−'}${money(Math.abs(value), plan)}`;
    if (comparison.budgetDelta !== 0) lines.push(`Budget: ${delta(comparison.budgetDelta)}`);
    if (comparison.guestTargetDelta !== 0) {
      lines.push(
        `Guest target: ${plan.guestTarget} → ${after.value.guestTarget} (${comparison.guestTargetDelta > 0 ? '+' : ''}${comparison.guestTargetDelta})`,
      );
    }
    if (comparison.committedDelta !== 0)
      lines.push(`Committed: ${delta(comparison.committedDelta)}`);
    if (comparison.newWarnings.length > 0) {
      lines.push(`${comparison.newWarnings.length} new warning(s) would appear`);
    }
    if (comparison.resolvedWarnings.length > 0) {
      lines.push(`${comparison.resolvedWarnings.length} warning(s) would clear`);
    }
    setPreview({ headline: 'Your own assumptions', lines });
    setNotice(null);
  }

  function applyCustom(): void {
    const actions = customScenarioActions(plan, customGuests, customBudget);
    if (actions === null || actions.length === 0) return;
    const outcome = store.applyAll(actions, 'What-if scenario: your own assumptions');
    setPreview(null);
    setNotice(
      outcome.ok
        ? 'Scenario applied as one undo step — use Undo in the header to reverse it.'
        : (outcome.message ?? 'The scenario could not be applied.'),
    );
  }

  function runStress(): void {
    const report = stressTest(plan, today);
    if (!report.ok) {
      setStress(null);
      setNotice(report.error.message);
      return;
    }
    setStress(report.value);
    setNotice(null);
  }

  function applyStress(): void {
    const actions = stressTestActions(plan);
    if (actions.length === 0) {
      setNotice('Nothing to apply — the shocks do not change this plan.');
      return;
    }
    const outcome = store.applyAll(actions, 'Stress scenario: all three shocks');
    setStress(null);
    setNotice(
      outcome.ok
        ? 'Stress scenario applied as one undo step — use Undo in the header to reverse it.'
        : (outcome.message ?? 'The stress scenario could not be applied.'),
    );
  }

  return (
    <section className="card" aria-labelledby="scenario-title">
      <h2 id="scenario-title">What-if scenarios</h2>
      <p className="muted">
        Preview a pressure on a copy of the plan. Nothing changes until you press Apply.
      </p>
      <fieldset>
        <legend>Choose a scenario</legend>
        {SCENARIOS.map((scenario) => (
          <label key={scenario.id} className="check" style={{ display: 'block' }}>
            <input
              type="radio"
              name="scenario"
              value={scenario.id}
              checked={selected === scenario.id}
              onChange={() => {
                setSelected(scenario.id);
                setPreview(null);
              }}
            />{' '}
            <strong>{scenario.label}</strong> — {scenario.description}
          </label>
        ))}
      </fieldset>
      <div className="row">
        <button type="button" onClick={showPreview} disabled={selected === null}>
          Preview impact
        </button>
        {preview !== null && (
          <>
            <button type="button" className="primary" onClick={apply}>
              Apply this scenario
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
              }}
            >
              Discard preview
            </button>
          </>
        )}
      </div>
      {preview !== null && (
        <div aria-live="polite">
          <h3>
            Preview: {preview.headline} <span className="muted">(simulated — not applied)</span>
          </h3>
          <ul>
            {preview.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>Your own assumptions</h3>
      <p className="muted">
        Set the guest count and/or budget you actually expect; preview shows the impact, and Apply
        is one undo step. Nothing changes until you apply.
      </p>
      <div className="row">
        <div>
          <label htmlFor="custom-guests">Guests</label>
          <input
            id="custom-guests"
            inputMode="numeric"
            value={customGuests}
            onChange={(event) => {
              setCustomGuests(event.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor="custom-budget">Budget in {plan.currency}</label>
          <input
            id="custom-budget"
            inputMode="decimal"
            value={customBudget}
            onChange={(event) => {
              setCustomBudget(event.target.value);
            }}
          />
        </div>
        <button type="button" onClick={showCustomPreview}>
          Preview my scenario
        </button>
        {preview !== null && preview.headline === 'Your own assumptions' && (
          <button type="button" className="primary" onClick={applyCustom}>
            Apply my scenario
          </button>
        )}
      </div>

      <h3>{STRESS_SPEC.label}</h3>
      <p className="muted">{STRESS_SPEC.description} Nothing changes until you apply.</p>
      <div className="row">
        <button type="button" onClick={runStress}>
          Run stress test
        </button>
        {stress !== null && (
          <>
            <button type="button" className="primary" onClick={applyStress}>
              Apply stress scenario
            </button>
            <button
              type="button"
              onClick={() => {
                setStress(null);
              }}
            >
              Discard stress result
            </button>
          </>
        )}
      </div>
      {stress !== null && (
        <div aria-live="polite">
          <h3>
            {stress.survives ? 'The plan survives' : 'The plan breaks'}{' '}
            <span className="muted">(simulated — not applied)</span>
          </h3>
          <ul>
            <li>
              Guests: {plan.guestTarget} → {stress.guestTargetAfter}
            </li>
            <li>
              Budget: {money(plan.budgetMinor, plan)} → {money(stress.budgetAfter, plan)}
            </li>
            <li>Committed after the shocks: {money(stress.committedAfter, plan)}</li>
            {stress.overBudgetBy > 0 && <li>Over budget by: {money(stress.overBudgetBy, plan)}</li>}
            {stress.errorCount > 0 && (
              <li>{stress.errorCount} error-level warning(s) would appear</li>
            )}
            {stress.comparison.newWarnings.length > 0 && (
              <li>{stress.comparison.newWarnings.length} new warning(s) in total</li>
            )}
            {stress.comparison.resolvedWarnings.length > 0 && (
              <li>{stress.comparison.resolvedWarnings.length} warning(s) would clear</li>
            )}
          </ul>
        </div>
      )}
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

/** Builds the engine actions for the family's own guest/budget assumptions; null when invalid. */
function customScenarioActions(
  plan: Plan,
  guestsText: string,
  budgetText: string,
): PlanAction[] | null {
  const guestsRaw: unknown = Number(guestsText.trim());
  const budgetRaw = parseMajorAmount(budgetText.trim(), plan.currency);
  if (guestsText.trim().length === 0 && budgetText.trim().length === 0) return [];
  const guestsValid =
    guestsText.trim().length > 0 && Number.isInteger(guestsRaw) && (guestsRaw as number) >= 1;
  const budgetGiven = budgetText.trim().length > 0;
  if (guestsText.trim().length > 0 && !guestsValid) return null;
  if (budgetGiven && budgetRaw === null) return null;
  const changes: { guestTarget?: number; budgetMinor?: number } = {};
  if (guestsValid) changes.guestTarget = guestsRaw as number;
  if (budgetGiven && budgetRaw !== null) changes.budgetMinor = budgetRaw;
  if (changes.guestTarget === plan.guestTarget && changes.budgetMinor === plan.budgetMinor) {
    return [];
  }
  return [{ type: 'event/update', changes }];
}

/** Runs actions on a COPY for preview; the real plan is only touched by Apply. */
function reducePlanCopy(plan: Plan, actions: readonly PlanAction[], today: string): Result<Plan> {
  let current = plan;
  for (const action of actions) {
    const next = reducePlan(current, action, { today });
    if (!next.ok) return next;
    current = next.value;
  }
  return ok(current);
}
