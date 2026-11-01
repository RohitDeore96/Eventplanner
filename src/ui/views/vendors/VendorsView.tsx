import { useCallback, useEffect, useState } from 'react';
import type { PlanAction } from '../../../engine/actions';
import { BOOKING_STATUSES } from '../../../engine/enums';
import { parseMajorAmount } from '../../../engine/money';
import type { BookingStatus, Plan } from '../../../engine/types';
import { checkEnum } from '../../../engine/validate';
import { usePlan } from '../../../state/store';
import { onQuotesChanged } from '../../../state/quotes';
import { text } from '../form';
import { STATUS_OPTIONS } from './shared';
import { QuoteBox } from './quote/QuoteBox';
import { QuotationCompare } from './quote/QuotationCompare';
import { VendorCard } from './VendorCard';
import { VendorChecklist } from './VendorChecklist';

/** Per-category vendor checklist: which vendor types to book, with booking status. */
export function VendorsView({ plan }: { plan: Plan }): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);
  // Saved quotations live outside the plan; this counter re-reads the library after changes.
  const [quotesVersion, setQuotesVersion] = useState(0);
  const refreshQuotes = useCallback((): void => {
    setQuotesVersion((version) => version + 1);
  }, []);
  // Writes from outside this view — the header's Undo/Redo reverting or re-applying an
  // accepted quotation — must also refresh the library, or the badge goes stale.
  useEffect(() => onQuotesChanged(refreshQuotes), [refreshQuotes]);
  // Vendor list search and booking-status filter (M5.1).
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BookingStatus>('all');
  const visibleVendors = plan.vendors.filter((vendor) => {
    const q = query.trim().toLowerCase();
    const matchesQuery =
      q.length === 0 ||
      vendor.name.toLowerCase().includes(q) ||
      vendor.contactPerson.toLowerCase().includes(q) ||
      vendor.contactNote.toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all' || vendor.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  return (
    <>
      <VendorChecklist plan={plan} />

      <section className="card" aria-labelledby="addvendor-title">
        <h2 id="addvendor-title">Add a vendor</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            // Same closed set, same wording the engine's own checkEnum produces for this
            // field — a tampered value surfaces exactly the rejection it always did.
            const status = checkEnum(
              text(data, 'status'),
              BOOKING_STATUSES,
              'status',
              'Booking status',
            );
            if (!status.ok) {
              setNotice(status.error.message);
              return;
            }
            const priceText = text(data, 'price').trim();
            const committed =
              priceText.length > 0 ? parseMajorAmount(priceText, plan.currency) : null;
            const action: PlanAction = {
              type: 'vendor/add',
              id: `v-${Date.now().toString(36)}`,
              categoryId: text(data, 'category'),
              name: text(data, 'name'),
              contactNote: text(data, 'note'),
              contactPerson: text(data, 'person'),
              phone: text(data, 'phone'),
              email: text(data, 'email'),
              status: status.value,
              committedMinor: status.value === 'booked' ? committed : null,
            };
            const outcome = store.apply(action);
            if (outcome.ok) {
              form.reset();
              setNotice(null);
            } else {
              setNotice(outcome.message ?? 'The vendor was not added.');
            }
          }}
        >
          <div>
            <label htmlFor="v-name">Vendor name</label>
            <input id="v-name" name="name" required maxLength={80} />
          </div>
          <div>
            <label htmlFor="v-category">Category</label>
            <select id="v-category" name="category">
              {plan.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="v-status">Status</label>
            <select id="v-status" name="status" defaultValue="contacted">
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="v-price">Agreed price (only for booked)</label>
            <input id="v-price" name="price" inputMode="decimal" />
          </div>
          <div>
            <label htmlFor="v-person">Contact person (optional)</label>
            <input id="v-person" name="person" maxLength={120} />
          </div>
          <div>
            <label htmlFor="v-phone">Phone (optional)</label>
            <input id="v-phone" name="phone" type="tel" maxLength={40} />
          </div>
          <div>
            <label htmlFor="v-email">Email (optional)</label>
            <input id="v-email" name="email" type="email" maxLength={120} />
          </div>
          <div>
            <label htmlFor="v-note">Contact note</label>
            <input id="v-note" name="note" maxLength={500} />
          </div>
          <button type="submit" className="primary">
            Add vendor
          </button>
        </form>
        {notice !== null && (
          <p className="field-error" role="alert">
            {notice}
          </p>
        )}
      </section>

      <QuoteBox plan={plan} onSaved={refreshQuotes} />

      <QuotationCompare plan={plan} onChanged={refreshQuotes} version={quotesVersion} />

      {plan.vendors.length > 0 && (
        <section aria-labelledby="vendors-title">
          <h2 id="vendors-title">Your vendors ({plan.vendors.length})</h2>
          <div className="row">
            <div>
              <label htmlFor="v-search">Search vendors</label>
              <input
                id="v-search"
                type="search"
                placeholder="Name, person or note"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            <div>
              <label htmlFor="v-status-filter">Filter by status</label>
              <select
                id="v-status-filter"
                value={statusFilter}
                onChange={(event) => {
                  // Same closed set as this select's own options ('all' plus the canonical
                  // booking statuses). A tampered or synthetic change event can deliver any
                  // string, so prove the value like every other user-controlled input instead
                  // of asserting it; a foreign value falls back to 'all' and never reaches
                  // the filter state.
                  const filter = checkEnum<'all' | BookingStatus>(
                    event.target.value,
                    ['all', ...BOOKING_STATUSES],
                    'status',
                    'Status filter',
                  );
                  setStatusFilter(filter.ok ? filter.value : 'all');
                }}
              >
                <option value="all">All statuses</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {visibleVendors.length === 0 ? (
            <p className="muted">No vendors match this search or filter.</p>
          ) : (
            visibleVendors.map((vendor) => (
              <VendorCard key={vendor.id} plan={plan} vendor={vendor} />
            ))
          )}
        </section>
      )}
    </>
  );
}
