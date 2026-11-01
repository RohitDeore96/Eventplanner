import { useState } from 'react';
import { parseMajorAmount } from '../../../engine/money';
import type { Instalment, Plan, Vendor } from '../../../engine/types';
import { money } from '../../../lib/format';
import { usePlan } from '../../../state/store';
import { text } from '../form';
import { KIND_LABELS, displayMajor } from './shared';

export function InstalmentRow({
  plan,
  vendor,
  instalment,
  paid,
  onRemove,
}: {
  plan: Plan;
  vendor: Vendor;
  instalment: Instalment;
  paid: number;
  onRemove: (id: string) => void;
}): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);
  const today = new Date().toLocaleDateString('sv-SE');
  const outstanding = Math.max(0, instalment.amountMinor - paid);
  const settled = paid >= instalment.amountMinor;
  const overdue = !settled && instalment.dueISO < today;
  const status = settled
    ? 'Paid in full'
    : paid > 0
      ? `Partly paid — balance due ${money(outstanding, plan)}`
      : overdue
        ? 'Overdue'
        : 'Not paid yet';

  function recordPayment(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amountMinor = parseMajorAmount(text(data, 'amount'), plan.currency);
    const outcome = store.apply({
      type: 'expense/add',
      id: `x-${Date.now().toString(36)}`,
      categoryId: vendor.categoryId,
      vendorId: vendor.id,
      instalmentId: instalment.id,
      dateISO: text(data, 'date'),
      amountMinor: amountMinor ?? -1,
      note: `${KIND_LABELS[instalment.kind]} to ${vendor.name}`,
    });
    setNotice(
      outcome.ok
        ? `Recorded ${money(amountMinor ?? 0, plan)} against this payment.`
        : (outcome.message ?? 'The payment was not recorded.'),
    );
  }

  return (
    <tr>
      <th scope="row">{KIND_LABELS[instalment.kind]}</th>
      <td>{instalment.dueISO}</td>
      <td>{money(instalment.amountMinor, plan)}</td>
      <td>{money(paid, plan)}</td>
      <td>
        <span className={`badge ${settled ? 'success' : ''}`}>
          <span aria-hidden="true">{settled ? '✓' : overdue ? '!' : '•'}</span> {status}
        </span>
      </td>
      <td>
        {settled ? (
          <span className="muted">Settled</span>
        ) : (
          <>
            {/* key re-mounts the form when the outstanding balance changes, so the
               pre-filled amount is never a stale number from a previous render. */}
            <form key={outstanding} className="row" onSubmit={recordPayment}>
              <label className="visually-hidden" htmlFor={`${instalment.id}-amount`}>
                Amount paid now
              </label>
              <input
                id={`${instalment.id}-amount`}
                name="amount"
                inputMode="decimal"
                defaultValue={displayMajor(outstanding, plan)}
                size={8}
              />
              <label className="visually-hidden" htmlFor={`${instalment.id}-date`}>
                Payment date
              </label>
              <input
                id={`${instalment.id}-date`}
                name="date"
                type="date"
                defaultValue={today}
                size={10}
              />
              <button type="submit" className="subtle">
                Record payment
              </button>
              {notice !== null && (
                <span className="muted" role="status">
                  {notice}
                </span>
              )}
            </form>
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();
                onRemove(instalment.id);
              }}
            >
              <button type="submit" className="subtle">
                Remove from schedule
              </button>
              <span className="muted">Unpaid instalments can be removed; paid ones cannot.</span>
            </form>
          </>
        )}
      </td>
    </tr>
  );
}
