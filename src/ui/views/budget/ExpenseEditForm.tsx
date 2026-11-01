import { useState } from 'react';
import { parseMajorAmount } from '../../../engine/money';
import type { Plan } from '../../../engine/types';
import { usePlan } from '../../../state/store';
import { text } from '../form';
import { nameOf } from './shared';

export /** Edit form including vendor/instalment re-assignment (M6.2). */
function ExpenseEditForm({
  plan,
  expenseId,
  onDone,
  onNotice,
}: {
  plan: Plan;
  expenseId: string;
  onDone: () => void;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const expense = plan.expenses.find((x) => x.id === expenseId);
  if (expense === undefined) return null;
  const [vendorId, setVendorId] = useState(expense.vendorId ?? '');
  const [instalmentId, setInstalmentId] = useState(expense.instalmentId ?? '');
  const selectedVendor =
    vendorId === '' ? null : (plan.vendors.find((v) => v.id === vendorId) ?? null);
  return (
    <form
      className="row"
      aria-label="Edit expense"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const amount = parseMajorAmount(text(data, 'amount'), plan.currency);
        const vendor = vendorId === '' ? null : vendorId;
        const instalment = vendor === null || instalmentId === '' ? null : instalmentId;
        const outcome = store.apply({
          type: 'expense/update',
          id: expenseId,
          amountMinor: amount ?? expense.amountMinor,
          dateISO: text(data, 'date'),
          note: text(data, 'note'),
          vendorId: vendor,
          instalmentId: instalment,
        });
        if (outcome.ok) {
          onNotice('Expense updated.');
          onDone();
        } else {
          onNotice(outcome.message ?? 'That expense was not updated.');
        }
      }}
    >
      <div>
        <label htmlFor={`xe-${expenseId}-amount`}>Amount</label>
        <input
          id={`xe-${expenseId}-amount`}
          name="amount"
          inputMode="decimal"
          defaultValue={String(Math.round(expense.amountMinor / 100))}
          required
        />
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-date`}>Date</label>
        <input
          id={`xe-${expenseId}-date`}
          name="date"
          type="date"
          defaultValue={expense.dateISO}
          required
        />
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-vendor`}>
          Vendor (this expense's category: {nameOf(plan, expense.categoryId)})
        </label>
        <select
          id={`xe-${expenseId}-vendor`}
          value={vendorId}
          onChange={(event) => {
            setVendorId(event.target.value);
            setInstalmentId('');
          }}
        >
          <option value="">No vendor — direct spend</option>
          {/* The engine requires the expense's category to match its vendor's category, so
              only vendors of this expense's own category are offered here. */}
          {plan.vendors
            .filter((v) => v.categoryId === expense.categoryId)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-inst`}>Payment instalment</label>
        <select
          id={`xe-${expenseId}-inst`}
          value={instalmentId}
          disabled={selectedVendor === null || selectedVendor.schedule.length === 0}
          onChange={(event) => {
            setInstalmentId(event.target.value);
          }}
        >
          <option value="">Not linked to an instalment</option>
          {(selectedVendor?.schedule ?? []).map((instalment) => (
            <option key={instalment.id} value={instalment.id}>
              {instalment.kind} · due {instalment.dueISO}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-note`}>Note</label>
        <input
          id={`xe-${expenseId}-note`}
          name="note"
          defaultValue={expense.note}
          maxLength={500}
        />
      </div>
      <button type="submit" className="primary">
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          onDone();
        }}
      >
        Cancel
      </button>
      <p className="muted">
        Amounts are in major units ({plan.currency}); a scheduled payment that is already partly
        paid keeps its history when you change the vendor — the old link is simply cleared.
      </p>
    </form>
  );
}
