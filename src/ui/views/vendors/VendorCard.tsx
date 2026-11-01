import { useState } from 'react';
import type { PlanAction } from '../../../engine/actions';
import { instalmentPayments } from '../../../engine/budget';
import { BOOKING_STATUSES } from '../../../engine/enums';
import { parseMajorAmount } from '../../../engine/money';
import type { Plan, Vendor } from '../../../engine/types';
import { checkEnum } from '../../../engine/validate';
import { usePlan } from '../../../state/store';
import { text } from '../form';
import { AddInstalmentForm } from './AddInstalmentForm';
import { InstalmentRow } from './InstalmentRow';
import { STATUS_OPTIONS, displayMajor } from './shared';
import { VendorEditForm } from './VendorEditForm';
import { VendorMoneySummary } from './VendorMoneySummary';
import { VendorPaymentHistory } from './VendorPaymentHistory';

/** The muted contact line under the vendor name; empty fields contribute nothing. */
function contactLine(vendor: Vendor): string {
  return [
    vendor.contactPerson.length > 0 ? vendor.contactPerson : null,
    vendor.phone.length > 0 ? vendor.phone : null,
    vendor.email.length > 0 ? vendor.email : null,
    vendor.contactNote.length > 0 ? vendor.contactNote : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** The agreed-price quick form; a blank field clears the price. */
function AgreedPriceForm({
  vendor,
  plan,
  onApply,
}: {
  vendor: Vendor;
  plan: Plan;
  onApply: (action: PlanAction, successMessage: string) => void;
}) {
  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        const priceText = text(new FormData(event.currentTarget), 'agreed').trim();
        const committed = priceText.length > 0 ? parseMajorAmount(priceText, plan.currency) : null;
        onApply({ type: 'vendor/update', id: vendor.id, committedMinor: committed }, 'Saved.');
      }}
    >
      <div>
        <label htmlFor={`${vendor.id}-agreed`}>Agreed price (blank clears it)</label>
        <input
          id={`${vendor.id}-agreed`}
          name="agreed"
          inputMode="decimal"
          defaultValue={
            vendor.committedMinor === null ? '' : displayMajor(vendor.committedMinor, plan)
          }
        />
      </div>
      <button type="submit">Save price</button>
    </form>
  );
}

/** One vendor: details (editable), financial summary, schedule, payment history. */
export function VendorCard({ plan, vendor }: { plan: Plan; vendor: Vendor }): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const paidByInstalment = instalmentPayments(plan.expenses);
  const category = plan.categories.find((c) => c.id === vendor.categoryId);

  function apply(action: PlanAction, successMessage: string): void {
    const outcome = store.apply(action);
    setNotice(outcome.ok ? successMessage : (outcome.message ?? 'That change was rejected.'));
  }

  return (
    <div className="card" aria-labelledby={`vendor-${vendor.id}`}>
      <h3 id={`vendor-${vendor.id}`}>{vendor.name}</h3>
      <p className="muted">
        {category?.name ?? 'Unknown category'}
        {contactLine(vendor).length > 0 ? ` · ${contactLine(vendor)}` : ''}
      </p>
      <div className="row">
        <div>
          <label htmlFor={`${vendor.id}-status`}>Booking status</label>
          <select
            id={`${vendor.id}-status`}
            value={vendor.status}
            onChange={(event) => {
              // Proven before it is typed: the select is user input, and a tampered
              // value surfaces the same rejection the engine itself produces.
              const status = checkEnum(
                event.target.value,
                BOOKING_STATUSES,
                'status',
                'Booking status',
              );
              if (!status.ok) {
                setNotice(status.error.message);
                return;
              }
              apply(
                {
                  type: 'vendor/update',
                  id: vendor.id,
                  status: status.value,
                },
                'Status updated.',
              );
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <AgreedPriceForm vendor={vendor} plan={plan} onApply={apply} />
        <button
          type="button"
          className="subtle"
          onClick={() => {
            setEditing((value) => !value);
          }}
        >
          {editing ? 'Close details' : 'Edit details'}
        </button>
        {confirmingRemove ? (
          <>
            <button
              type="button"
              className="danger"
              onClick={() => {
                apply({ type: 'vendor/delete', id: vendor.id }, 'Vendor removed.');
              }}
            >
              Really remove “{vendor.name}”
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingRemove(false);
              }}
            >
              Keep
            </button>
          </>
        ) : (
          <button
            type="button"
            className="subtle"
            onClick={() => {
              setConfirmingRemove(true);
            }}
          >
            Remove
          </button>
        )}
      </div>
      {editing && (
        <VendorEditForm
          vendor={vendor}
          onDone={() => {
            setEditing(false);
          }}
        />
      )}

      <VendorMoneySummary plan={plan} vendor={vendor} />

      <h4>Payment schedule</h4>
      {vendor.schedule.length === 0 ? (
        <p className="muted">
          No scheduled payments yet. Add the advance and final payment below — they show up as
          overdue warnings and settle only when real payments are recorded.
        </p>
      ) : (
        <table tabIndex={0}>
          <caption className="visually-hidden">
            Scheduled payments for {vendor.name} with paid amounts and status
          </caption>
          <thead>
            <tr>
              <th scope="col">Payment</th>
              <th scope="col">Due</th>
              <th scope="col">Amount</th>
              <th scope="col">Paid</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Record payment</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {vendor.schedule.map((instalment) => (
              <InstalmentRow
                key={instalment.id}
                plan={plan}
                vendor={vendor}
                instalment={instalment}
                paid={paidByInstalment.get(instalment.id) ?? 0}
                onRemove={(id) => {
                  apply(
                    {
                      type: 'vendor/setSchedule',
                      id: vendor.id,
                      schedule: vendor.schedule.filter((i) => i.id !== id),
                    },
                    'Scheduled payment removed.',
                  );
                }}
              />
            ))}
          </tbody>
        </table>
      )}
      <AddInstalmentForm
        plan={plan}
        vendor={vendor}
        onAdd={(instalment) => {
          apply(
            {
              type: 'vendor/setSchedule',
              id: vendor.id,
              schedule: [...vendor.schedule, instalment],
            },
            'Payment scheduled.',
          );
        }}
      />

      <VendorPaymentHistory plan={plan} vendor={vendor} />

      {notice !== null && notice.length > 0 && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
