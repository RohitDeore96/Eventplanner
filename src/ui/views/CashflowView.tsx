import { useMemo } from 'react';
import { cashflow } from '../../engine/cashflow';
import type { Plan } from '../../engine/types';
import { money } from '../../lib/format';
import { KIND_LABELS } from './vendors';

/**
 * X8 cash-flow calendar: the year at a glance — which month carries which payments, what
 * has been settled, what is still to pay, and anything overdue at the very top.
 */

function monthLabel(key: string, locale: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 15));
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function shortDate(iso: string, locale: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function CashflowView({ plan }: { plan: Plan }): React.ReactNode {
  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
  }, []);
  const report = useMemo(() => cashflow(plan, today), [plan, today]);

  return (
    <section className="card" aria-labelledby="cashflow-title">
      <h2 id="cashflow-title">Cash-flow calendar</h2>
      <p className="muted">
        Every scheduled payment by month — what is settled, what is still to pay, and what is
        overdue. Record payments against a vendor's schedule in the Vendors tab and this calendar
        follows.
      </p>
      {report.totals.scheduledMinor === 0 ? (
        <p className="muted">
          No scheduled payments yet. Set a payment schedule on a vendor (advance, instalments, final
          balance) and the months appear here.
        </p>
      ) : (
        <>
          <p>
            <strong>
              Scheduled {money(report.totals.scheduledMinor, plan)} · paid{' '}
              {money(report.totals.paidMinor, plan)} · still to pay{' '}
              {money(report.totals.toPayMinor, plan)}
            </strong>
          </p>
          {report.overdue.length > 0 && (
            <div role="alert" className="alert">
              <strong>
                <span aria-hidden="true">⚠️</span> {report.overdue.length} payment(s) overdue —{' '}
                {money(
                  report.overdue.reduce((sum, e) => sum + e.toPayMinor, 0),
                  plan,
                )}{' '}
                past due.
              </strong>
            </div>
          )}
          {report.months.map((month) => (
            <div key={month.month} className="cashflow-month">
              <h3>
                {monthLabel(month.month, plan.locale)}{' '}
                <span className="muted">
                  — {money(month.toPayMinor, plan)} to pay of {money(month.scheduledMinor, plan)}
                </span>
              </h3>
              <table tabIndex={0}>
                <thead>
                  <tr>
                    <th scope="col">Due</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Paid</th>
                    <th scope="col">Still to pay</th>
                  </tr>
                </thead>
                <tbody>
                  {month.entries.map((entry) => (
                    <tr key={entry.instalmentId}>
                      <td>{shortDate(entry.dueISO, plan.locale)}</td>
                      <td>{entry.vendorName}</td>
                      <td>{KIND_LABELS[entry.kind]}</td>
                      <td>{money(entry.amountMinor, plan)}</td>
                      <td>{money(entry.paidMinor, plan)}</td>
                      <td>
                        {entry.overdue && <span className="badge warn">overdue</span>}{' '}
                        {money(entry.toPayMinor, plan)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
