import { useState } from 'react';
import { parseMajorAmount } from '../../../engine/money';
import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';
import { usePlan } from '../../../state/store';
import { text } from '../form';

export /** Add-expense form with the vendor → instalment cascade (M6.2). */
function ExpenseForm({
  plan,
  onNotice,
}: {
  plan: Plan;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const [vendorId, setVendorId] = useState('');
  const [instalmentId, setInstalmentId] = useState('');
  const selectedVendor =
    vendorId === '' ? null : (plan.vendors.find((v) => v.id === vendorId) ?? null);
  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const amount = parseMajorAmount(text(data, 'amount'), plan.currency);
        const vendor = vendorId === '' ? null : vendorId;
        const instalment = vendor === null || instalmentId === '' ? null : instalmentId;
        // A vendor's expense must sit in the vendor's own category (engine rule) — pick it
        // for the family instead of letting a mismatch fail later.
        const categoryId =
          vendor !== null
            ? (plan.vendors.find((v) => v.id === vendor)?.categoryId ?? text(data, 'category'))
            : text(data, 'category');
        const outcome = store.apply({
          type: 'expense/add',
          id: `xp-${Date.now().toString(36)}`,
          categoryId,
          vendorId: vendor,
          instalmentId: instalment,
          dateISO: text(data, 'date'),
          amountMinor: amount ?? -1,
          note: text(data, 'note'),
        });
        if (outcome.ok) {
          form.reset();
          setVendorId('');
          setInstalmentId('');
          onNotice('Expense recorded.');
        } else {
          onNotice(outcome.message ?? 'That expense was not recorded.');
        }
      }}
    >
      <div>
        <label htmlFor="xp-category">Category</label>
        <select id="xp-category" name="category" disabled={selectedVendor !== null}>
          {plan.categories.map((c) => (
            <option
              key={c.id}
              value={c.id}
              selected={selectedVendor !== null && c.id === selectedVendor.categoryId}
            >
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="xp-vendor">Vendor (optional)</label>
        <select
          id="xp-vendor"
          value={vendorId}
          onChange={(event) => {
            setVendorId(event.target.value);
            // An instalment belongs to ONE vendor: switching vendors clears the choice.
            setInstalmentId('');
          }}
        >
          <option value="">No vendor — direct spend</option>
          {plan.vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="xp-instalment">
          {selectedVendor === null
            ? 'Payment instalment (needs a vendor)'
            : selectedVendor.schedule.length === 0
              ? `${selectedVendor.name} has no scheduled payments`
              : 'Payment instalment (optional)'}
        </label>
        <select
          id="xp-instalment"
          value={instalmentId}
          disabled={selectedVendor === null || selectedVendor.schedule.length === 0}
          onChange={(event) => {
            setInstalmentId(event.target.value);
          }}
        >
          <option value="">Not linked to an instalment</option>
          {(selectedVendor?.schedule ?? []).map((instalment) => (
            <option key={instalment.id} value={instalment.id}>
              {instalment.kind} · due {instalment.dueISO} · {money(instalment.amountMinor, plan)}
              {instalment.note.length > 0 ? ` · ${instalment.note}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="xp-amount">Amount spent</label>
        <input id="xp-amount" name="amount" inputMode="decimal" required />
      </div>
      <div>
        <label htmlFor="xp-date">Date</label>
        <input id="xp-date" name="date" type="date" required />
      </div>
      <div>
        <label htmlFor="xp-note">Note (optional)</label>
        <input id="xp-note" name="note" maxLength={500} />
      </div>
      <button type="submit" className="primary">
        Add expense
      </button>
    </form>
  );
}
