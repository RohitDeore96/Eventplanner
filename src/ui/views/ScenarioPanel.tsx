import { useMemo, useState } from 'react';
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
import { currencyExponent } from '../../engine/money';
import type { Plan } from '../../engine/types';
import { localToday } from '../../lib/format';
import { usePlan } from '../../state/store';
import { StressReportView } from './scenario/StressReportView';
import { ScenarioPicker } from './scenario/ScenarioPicker';
import { CustomAssumptionInputs } from './scenario/CustomAssumptionInputs';
import {
  customPreviewLines,
  customScenarioActions,
  reducePlanCopy,
  scenarioPreviewLines,
} from './scenario/scenarioPreview';

/**
 * What-if scenarios (X2): pick a pressure, PREVIEW its exact impact on a copy of the plan,
 * and only apply on an explicit approval. The preview can never mutate the real plan; apply
 * runs the same engine actions the family could have done by hand, so undo reverses it.
 * Preview wording and input parsing live in `scenario/scenarioPreview.ts`.
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
    String(Math.round(plan.budgetMinor / 10 ** (currencyExponent(plan.currency) ?? 2))),
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
    setPreview({
      headline: spec?.label ?? 'Scenario',
      lines: scenarioPreviewLines(plan, comparison),
    });
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
    setPreview({
      headline: 'Your own assumptions',
      lines: customPreviewLines(plan, comparison, after.value.guestTarget),
    });
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
      <ScenarioPicker
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          setPreview(null);
        }}
      />
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
      <CustomAssumptionInputs
        plan={plan}
        guests={customGuests}
        budget={customBudget}
        onGuests={setCustomGuests}
        onBudget={setCustomBudget}
        onPreview={showCustomPreview}
        onApply={applyCustom}
        previewShown={preview !== null && preview.headline === 'Your own assumptions'}
      />

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
      {stress !== null && <StressReportView plan={plan} stress={stress} />}
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
