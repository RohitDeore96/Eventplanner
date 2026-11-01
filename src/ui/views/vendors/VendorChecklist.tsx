import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';
import { STATUS_OPTIONS } from './shared';

/**
 * Per-category booking checklist: which vendor types to book, each with its planned
 * amount and the current booking status of the non-cancelled vendor holding the
 * category. Read-only — every edit happens in the vendor cards below it.
 */
export function VendorChecklist({ plan }: { plan: Plan }): React.ReactNode {
  return (
    <section className="card" aria-labelledby="checklist-title">
      <h2 id="checklist-title">Booking checklist</h2>
      <table tabIndex={0}>
        <caption className="visually-hidden">Vendor categories with booking progress</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Planned</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {plan.categories
            .filter((c) => c.key !== 'contingency')
            .map((category) => {
              const vendor = plan.vendors.find(
                (v) => v.categoryId === category.id && v.status !== 'cancelled',
              );
              const label =
                vendor === undefined
                  ? 'Not started'
                  : (STATUS_OPTIONS.find((s) => s.value === vendor.status)?.label ?? vendor.status);
              return (
                <tr key={category.id}>
                  <th scope="row">{category.name}</th>
                  <td>{money(category.plannedMinor, plan)}</td>
                  <td>
                    <span className={`badge ${vendor?.status === 'booked' ? 'success' : ''}`}>
                      <span aria-hidden="true">{vendor?.status === 'booked' ? '✓' : '•'}</span>{' '}
                      {label}
                    </span>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </section>
  );
}
