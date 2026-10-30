import { useMemo, useState } from 'react';
import {
  comparePlans,
  buildScenario,
  SCENARIOS,
  scenarioActions,
  type ScenarioId,
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
  const [notice, setNotice] = useState<string | null>(null);

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
    const outcome = store.applyAll(actions);
    setPreview(null);
    setNotice(
      outcome.ok
        ? 'Scenario applied as one undo step — use Undo in the header to reverse it.'
        : (outcome.message ?? 'The scenario could not be applied.'),
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
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
