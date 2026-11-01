import { useState } from 'react';
import { parseMajorAmount } from '../../../../engine/money';
import type { Plan } from '../../../../engine/types';
import type { QuoteFields } from '../../../../schemas/ai';
import { displayMajor } from '../shared';

/** Manual correction of every extracted field before the quotation is saved (M7.2). */
export function QuoteDraftEditor({
  plan,
  draft,
  onEdit,
}: {
  plan: Plan;
  draft: QuoteFields;
  onEdit: (patch: Partial<QuoteFields>) => void;
}): React.ReactNode {
  const [total, setTotal] = useState(
    draft.totalPriceMinor === null ? '' : displayMajor(draft.totalPriceMinor, plan),
  );
  const [perPlate, setPerPlate] = useState(
    draft.pricePerPlateMinor === null ? '' : displayMajor(draft.pricePerPlateMinor, plan),
  );
  return (
    <fieldset>
      <legend>Correct anything the reader got wrong (money in {plan.currency})</legend>
      <div className="grid">
        <div>
          <label htmlFor="q-vendor">Vendor name</label>
          <input
            id="q-vendor"
            value={draft.vendorName ?? ''}
            maxLength={80}
            onChange={(event) => {
              onEdit({ vendorName: event.target.value.trim() || null });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-total">Stated total (blank = not stated)</label>
          <input
            id="q-total"
            inputMode="decimal"
            value={total}
            onChange={(event) => {
              setTotal(event.target.value);
              const parsed = parseMajorAmount(event.target.value, plan.currency);
              onEdit({ totalPriceMinor: parsed });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-plate">Per-plate rate (blank = not stated)</label>
          <input
            id="q-plate"
            inputMode="decimal"
            value={perPlate}
            onChange={(event) => {
              setPerPlate(event.target.value);
              const parsed = parseMajorAmount(event.target.value, plan.currency);
              onEdit({ pricePerPlateMinor: parsed });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-min">Guest minimum (blank = not stated)</label>
          <input
            id="q-min"
            inputMode="numeric"
            value={draft.guestMinimum ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value);
              onEdit({
                guestMinimum: Number.isInteger(value) && value >= 0 ? value : null,
              });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-advance">Advance % (blank = not stated)</label>
          <input
            id="q-advance"
            inputMode="numeric"
            value={draft.advancePercent ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value);
              onEdit({
                advancePercent:
                  Number.isInteger(value) && value >= 0 && value <= 100 ? value : null,
              });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-tax">Tax included</label>
          <select
            id="q-tax"
            value={draft.taxIncluded === null ? 'unknown' : draft.taxIncluded ? 'yes' : 'no'}
            onChange={(event) => {
              const value = event.target.value;
              onEdit({ taxIncluded: value === 'unknown' ? null : value === 'yes' });
            }}
          >
            <option value="unknown">Not stated</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <label htmlFor="q-cancel">Cancellation policy (blank = not stated)</label>
          <input
            id="q-cancel"
            value={draft.cancellationPolicy ?? ''}
            maxLength={300}
            onChange={(event) => {
              onEdit({ cancellationPolicy: event.target.value.trim() || null });
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}
