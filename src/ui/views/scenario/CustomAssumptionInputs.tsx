import type { Plan } from '../../../engine/types';

/**
 * The family's own what-if inputs: guest count and/or budget. Controlled inputs so the
 * panel can preview before anything is applied; the Apply button only appears while a
 * custom preview is on screen.
 */
export function CustomAssumptionInputs({
  plan,
  guests,
  budget,
  onGuests,
  onBudget,
  onPreview,
  onApply,
  previewShown,
}: {
  plan: Plan;
  guests: string;
  budget: string;
  onGuests: (value: string) => void;
  onBudget: (value: string) => void;
  onPreview: () => void;
  onApply: () => void;
  previewShown: boolean;
}) {
  return (
    <>
      <div className="row">
        <div>
          <label htmlFor="custom-guests">Guests</label>
          <input
            id="custom-guests"
            inputMode="numeric"
            value={guests}
            onChange={(event) => {
              onGuests(event.target.value);
            }}
          />
        </div>
        <div>
          <label htmlFor="custom-budget">Budget in {plan.currency}</label>
          <input
            id="custom-budget"
            inputMode="decimal"
            value={budget}
            onChange={(event) => {
              onBudget(event.target.value);
            }}
          />
        </div>
        <button type="button" onClick={onPreview}>
          Preview my scenario
        </button>
        {previewShown && (
          <button type="button" className="primary" onClick={onApply}>
            Apply my scenario
          </button>
        )}
      </div>
    </>
  );
}
