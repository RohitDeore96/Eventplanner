import { instalmentPayments, vendorPayments } from '../../../engine/budget';
import type { Plan, Vendor } from '../../../engine/types';
import { money } from '../../../lib/format';

/** Money summary from the engine's own aggregates (M5.4). */
export function VendorMoneySummary({
  plan,
  vendor,
}: {
  plan: Plan;
  vendor: Vendor;
}): React.ReactNode {
  const paidByInstalment = instalmentPayments(plan.expenses);
  const paidToVendor = vendorPayments(plan.expenses).get(vendor.id) ?? 0;
  const scheduledTotal = vendor.schedule.reduce((acc, i) => acc + i.amountMinor, 0);
  const nextDue = vendor.schedule
    .filter((i) => (paidByInstalment.get(i.id) ?? 0) < i.amountMinor)
    .map((i) => i.dueISO)
    .sort()[0];
  const unscheduled =
    vendor.committedMinor !== null && scheduledTotal !== vendor.committedMinor
      ? Math.max(0, vendor.committedMinor - scheduledTotal)
      : null;
  return (
    <>
      <h4>Money summary</h4>
      <p className="muted">
        Agreed {vendor.committedMinor === null ? 'not set' : money(vendor.committedMinor, plan)} ·
        scheduled {scheduledTotal === 0 ? 'nothing yet' : money(scheduledTotal, plan)} · paid{' '}
        {money(paidToVendor, plan)} · still to pay{' '}
        {money(Math.max(0, (vendor.committedMinor ?? 0) - paidToVendor), plan)}
        {nextDue !== undefined ? ` · next payment due ${nextDue}` : ''}
      </p>
      {unscheduled !== null && unscheduled > 0 && (
        <p className="muted">
          Unscheduled balance: {money(unscheduled, plan)} of the agreed price has no instalment yet.
        </p>
      )}
    </>
  );
}
