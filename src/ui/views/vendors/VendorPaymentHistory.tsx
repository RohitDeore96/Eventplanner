import type { Plan, Vendor } from '../../../engine/types';
import { money } from '../../../lib/format';
import { KIND_LABELS } from './shared';

/** Payment history: every recorded expense for this vendor, with its instalment link. */
export function VendorPaymentHistory({
  plan,
  vendor,
}: {
  plan: Plan;
  vendor: Vendor;
}): React.ReactNode {
  const history = plan.expenses.filter((e) => e.vendorId === vendor.id);
  if (history.length === 0) {
    return (
      <>
        <h4>Payment history</h4>
        <p className="muted">No payments recorded for this vendor yet.</p>
      </>
    );
  }
  return (
    <>
      <h4>Payment history</h4>
      <table tabIndex={0}>
        <caption className="visually-hidden">Payments recorded for {vendor.name}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Amount</th>
            <th scope="col">Against</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {history.map((expense) => (
            <tr key={expense.id}>
              <td>{expense.dateISO}</td>
              <td>{money(expense.amountMinor, plan)}</td>
              <td>
                {expense.instalmentId === null
                  ? 'Not linked to an instalment'
                  : KIND_LABELS[
                      vendor.schedule.find((i) => i.id === expense.instalmentId)?.kind ?? 'custom'
                    ]}
              </td>
              <td>{expense.note || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
