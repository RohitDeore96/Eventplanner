import { SCENARIOS, type ScenarioId } from '../../../engine/scenario';

/** The built-in what-if scenario choices, shown as a radio group. */
export function ScenarioPicker({
  selected,
  onSelect,
}: {
  selected: ScenarioId | null;
  onSelect: (id: ScenarioId) => void;
}) {
  return (
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
              onSelect(scenario.id);
            }}
          />{' '}
          <strong>{scenario.label}</strong> — {scenario.description}
        </label>
      ))}
    </fieldset>
  );
}
