import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanAction } from '../../../engine/actions';
import { parseMajorAmount } from '../../../engine/money';
import type { BookingStatus, Plan } from '../../../engine/types';
import { money } from '../../../lib/format';
import { usePlan } from '../../../state/store';
import {
  deleteQuote,
  loadQuotes,
  onQuotesChanged,
  setQuoteStatus,
  updateQuote,
  type SavedQuote,
} from '../../../state/quotes';
import {
  acceptActions,
  effectiveMinor,
  inquiryMessage,
  missingFields,
  riskFlags,
} from '../../../lib/quoteCompare';
import { text } from '../form';
import { STATUS_OPTIONS } from './shared';
import { QuoteBox } from './quote/QuoteBox';
import { VendorCard } from './VendorCard';

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
                    : (STATUS_OPTIONS.find((s) => s.value === vendor.status)?.label ??
                      vendor.status);
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

      <section className="card" aria-labelledby="addvendor-title">
        <h2 id="addvendor-title">Add a vendor</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const status = text(data, 'status') as BookingStatus;
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
              status,
              committedMinor: status === 'booked' ? committed : null,
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
                  setStatusFilter(event.target.value as 'all' | BookingStatus);
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

/**
 * Saved quotations, side by side. Comparison is deterministic; acceptance goes through the
 * engine so committed totals, warnings and undo behave like every other change.
 */
function QuotationCompare({
  plan,
  onChanged,
  version,
}: {
  plan: Plan;
  onChanged: () => void;
  version: number;
}): React.ReactNode {
  const store = usePlan();
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [notice, setNotice] = useState<string | null>(null);
  // Re-read the library whenever the version changes — without remounting, so notices stay.
  const all = useMemo(() => loadQuotes(plan.id), [plan.id, version]);
  const quotes =
    categoryFilter === 'all' ? all : all.filter((quote) => quote.categoryId === categoryFilter);
  const shown = quotes.slice(0, 3); // side-by-side comparison stays readable

  function accept(quote: SavedQuote): void {
    // Duplicate acceptance would re-book the vendor and double-apply the commitment (M7.4).
    if (quote.status === 'accepted') {
      setNotice('This quotation was already accepted — its vendor is booked. Nothing changed.');
      return;
    }
    if (quote.status === 'rejected') {
      setNotice('This quotation was rejected. Move it back to review before accepting it.');
      return;
    }
    const actions = acceptActions(plan, quote);
    if (actions === null) {
      setNotice(
        'This quote states neither a total nor a per-plate rate, so it cannot be accepted.',
      );
      return;
    }
    // The status write comes FIRST: if the library cannot be saved, the vendor must not
    // be booked against an acceptance that never persisted — the saved 'accepted' badge
    // is also the guard that blocks a second booking (M7.4).
    if (!setQuoteStatus(quote.id, 'accepted')) {
      setNotice(
        'The quotation status could not be saved, so the vendor was not booked. Free up storage space and try again.',
      );
      onChanged();
      return;
    }
    const outcome = store.applyAll(
      actions,
      `Quotation accepted — ${quote.fields.vendorName ?? 'vendor'} booked`,
      { id: quote.id, previousStatus: quote.status },
    );
    if (!outcome.ok) {
      // The engine refused the booking: put the status back so the quote is not left
      // marked accepted without the booking it promised. If this write also fails, the
      // notice below still reports the refused booking honestly.
      setQuoteStatus(quote.id, quote.status);
      setNotice(outcome.message ?? 'The quotation could not be accepted.');
      onChanged();
      return;
    }
    // The batch entry carries the quote reference, so Undo reverts both sides at once.
    setNotice(
      `Accepted "${quote.fields.vendorName ?? 'quotation'}" — the vendor is booked at the effective price. Undo takes it back.`,
    );
    onChanged();
  }

  return (
    <section className="card" aria-labelledby="compare-title">
      <h2 id="compare-title">Compare saved quotations</h2>
      {all.length === 0 ? (
        <p className="muted">
          No quotations saved yet. Read and save quotes above — up to three appear here side by
          side, and accepting one books the vendor at the effective price.
        </p>
      ) : (
        <>
          <div className="row">
            <div>
              <label htmlFor="compare-category">Category</label>
              <select
                id="compare-category"
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                }}
              >
                <option value="all">All categories</option>
                {plan.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="muted">No quotations saved for this category yet.</p>
          ) : (
            <div className="row" style={{ alignItems: 'stretch' }}>
              {shown.map((quote) => (
                <QuoteCard
                  key={quote.id}
                  plan={plan}
                  quote={quote}
                  onAccept={() => {
                    accept(quote);
                  }}
                  onStatus={(status) => {
                    setQuoteStatus(quote.id, status);
                    setNotice(
                      status === 'shortlisted'
                        ? 'Marked as shortlisted.'
                        : status === 'rejected'
                          ? 'Marked as rejected — it stays saved for reference.'
                          : 'Back under review.',
                    );
                    onChanged();
                  }}
                  onDetail={(changes) => {
                    updateQuote(quote.id, changes);
                    onChanged();
                  }}
                  onRemove={() => {
                    deleteQuote(quote.id);
                    setNotice('Quotation removed.');
                    onChanged();
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

/** The advance cell: percent, plus the amount when the effective price is known. */
function advanceLabel(fields: SavedQuote['fields'], effective: number | null, plan: Plan): string {
  if (fields.advancePercent === null) return 'Not stated';
  if (effective === null) return `${fields.advancePercent}%`;
  const amount = Math.round((effective * fields.advancePercent) / 100);
  return `${fields.advancePercent}% (${money(amount, plan)})`;
}

/** The vs-budget cell: under/over with exact amounts, never colour alone. */
function budgetLabel(gap: number | null, plan: Plan): string {
  if (gap === null) return '—';
  return gap >= 0 ? `${money(gap, plan)} under` : `${money(-gap, plan)} over`;
}

/** The comparison numbers for one quotation, computed outside JSX. */
function quoteCardRows(
  plan: Plan,
  quote: SavedQuote,
): {
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly effective: number | null;
  readonly flags: readonly string[];
  readonly missing: readonly string[];
} {
  const fields = quote.fields;
  const effective = effectiveMinor(fields, plan.guestTarget);
  const category = plan.categories.find((c) => c.id === quote.categoryId);
  const perGuest =
    effective === null || plan.guestTarget === 0 ? null : Math.round(effective / plan.guestTarget);
  const budgetGap =
    effective === null || category === undefined ? null : category.plannedMinor - effective;
  return {
    effective,
    flags: riskFlags(fields, plan),
    missing: missingFields(fields),
    rows: [
      {
        label: 'Stated total',
        value: fields.totalPriceMinor === null ? 'Not stated' : money(fields.totalPriceMinor, plan),
      },
      {
        label: `Effective for ${plan.guestTarget} guests`,
        value: effective === null ? 'Cannot compute' : money(effective, plan),
      },
      { label: 'Cost per guest', value: perGuest === null ? '—' : money(perGuest, plan) },
      { label: 'Vs category budget', value: budgetLabel(budgetGap, plan) },
      { label: 'Advance', value: advanceLabel(fields, effective, plan) },
      {
        label: 'Tax included',
        value: fields.taxIncluded === null ? 'Not stated' : fields.taxIncluded ? 'Yes' : 'No',
      },
      {
        label: 'Min. guests',
        value: fields.guestMinimum === null ? 'Not stated' : String(fields.guestMinimum),
      },
    ],
  };
}

const QUOTE_STATUS_LABELS: Readonly<Record<SavedQuote['status'], string>> = {
  review: 'Under review',
  shortlisted: 'Shortlisted',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

function QuoteCard({
  plan,
  quote,
  onAccept,
  onStatus,
  onDetail,
  onRemove,
}: {
  plan: Plan;
  quote: SavedQuote;
  onAccept: () => void;
  onStatus: (status: SavedQuote['status']) => void;
  onDetail: (changes: { validityDate?: string | null; note?: string }) => void;
  onRemove: () => void;
}): React.ReactNode {
  const fields = quote.fields;
  const { rows, effective, flags, missing } = quoteCardRows(plan, quote);
  const category = plan.categories.find((c) => c.id === quote.categoryId);
  const expired =
    quote.validityDate !== null && quote.validityDate < new Date().toLocaleDateString('sv-SE');

  return (
    <div
      className="card"
      style={{ flex: '1 1 260px' }}
      aria-label={`Quotation from ${fields.vendorName ?? 'unknown vendor'}`}
    >
      <h3>{fields.vendorName ?? 'Unnamed vendor'}</h3>
      <p className="muted">
        {category?.name ?? 'Unknown category'} · saved {quote.savedAtISO.slice(0, 10)}
      </p>
      <p>
        <span className={`badge ${quote.status === 'accepted' ? 'success' : ''}`}>
          <span aria-hidden="true">{quote.status === 'accepted' ? '✓' : '•'}</span>{' '}
          {QUOTE_STATUS_LABELS[quote.status]}
        </span>
        {expired && (
          <span className="badge error">
            <span aria-hidden="true">!</span> Validity passed {quote.validityDate}
          </span>
        )}
      </p>
      <table tabIndex={0}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Valid until</th>
            <td>
              <label className="visually-hidden" htmlFor={`v-${quote.id}`}>
                Valid until
              </label>
              <input
                id={`v-${quote.id}`}
                type="date"
                value={quote.validityDate ?? ''}
                onChange={(event) => {
                  onDetail({ validityDate: event.target.value || null });
                }}
              />
            </td>
          </tr>
          <tr>
            <th scope="row">Notes</th>
            <td>
              <label className="visually-hidden" htmlFor={`n-${quote.id}`}>
                Notes
              </label>
              <input
                id={`n-${quote.id}`}
                value={quote.note}
                maxLength={500}
                placeholder="Anything worth remembering"
                onChange={(event) => {
                  onDetail({ note: event.target.value });
                }}
              />
            </td>
          </tr>
        </tbody>
      </table>
      {missing.length > 0 && <p className="muted">Missing: {missing.join(', ')}.</p>}
      {flags.length > 0 && (
        <div className="alert">
          <strong>
            <span aria-hidden="true">⚠️</span> Check before accepting
          </strong>
          <ul>
            {flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
      <details>
        <summary>Draft an inquiry about the missing terms</summary>
        <textarea
          readOnly
          rows={5}
          value={inquiryMessage(fields, missing)}
          aria-label="Draft inquiry message"
        />
      </details>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={onAccept}
          disabled={effective === null || quote.status === 'accepted'}
        >
          {quote.status === 'accepted' ? 'Accepted' : 'Accept this quotation'}
        </button>
        <label className="visually-hidden" htmlFor={`s-${quote.id}`}>
          Quotation status
        </label>
        <select
          id={`s-${quote.id}`}
          value={quote.status}
          disabled={quote.status === 'accepted'}
          onChange={(event) => {
            const value = event.target.value as SavedQuote['status'];
            if (value !== quote.status) onStatus(value);
          }}
        >
          {(Object.keys(QUOTE_STATUS_LABELS) as readonly SavedQuote['status'][])
            // 'accepted' is only reachable through the engine-gated Accept button (booking);
            // a manual path here would lock the quote without a booking, and moving an
            // accepted quote back would defeat the never-accepted-twice guard.
            .filter((status) => quote.status === 'accepted' || status !== 'accepted')
            .map((status) => (
              <option key={status} value={status}>
                {QUOTE_STATUS_LABELS[status]}
              </option>
            ))}
        </select>
        <button type="button" className="subtle" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
