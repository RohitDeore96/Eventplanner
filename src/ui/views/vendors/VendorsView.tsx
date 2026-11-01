import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanAction } from '../../../engine/actions';
import { instalmentPayments, vendorPayments } from '../../../engine/budget';
import { parseMajorAmount } from '../../../engine/money';
import type { BookingStatus, Plan, Vendor } from '../../../engine/types';
import type { QuoteFields } from '../../../schemas/ai';
import { money } from '../../../lib/format';
import { aiClient } from '../../../lib/aiClient';
import { usePlan } from '../../../state/store';
import {
  deleteQuote,
  loadQuotes,
  onQuotesChanged,
  saveQuote,
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
import { AddInstalmentForm } from './AddInstalmentForm';
import { InstalmentRow } from './InstalmentRow';
import { KIND_LABELS, STATUS_OPTIONS, displayMajor } from './shared';

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

/** One vendor: details (editable), financial summary, schedule, payment history. */
function VendorCard({ plan, vendor }: { plan: Plan; vendor: Vendor }): React.ReactNode {
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
        {vendor.contactPerson.length > 0 ? ` · ${vendor.contactPerson}` : ''}
        {vendor.phone.length > 0 ? ` · ${vendor.phone}` : ''}
        {vendor.email.length > 0 ? ` · ${vendor.email}` : ''}
        {vendor.contactNote.length > 0 ? ` · ${vendor.contactNote}` : ''}
      </p>
      <div className="row">
        <div>
          <label htmlFor={`${vendor.id}-status`}>Booking status</label>
          <select
            id={`${vendor.id}-status`}
            value={vendor.status}
            onChange={(event) => {
              apply(
                {
                  type: 'vendor/update',
                  id: vendor.id,
                  status: event.target.value as BookingStatus,
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
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const priceText = text(new FormData(event.currentTarget), 'agreed').trim();
            const committed =
              priceText.length > 0 ? parseMajorAmount(priceText, plan.currency) : null;
            apply({ type: 'vendor/update', id: vendor.id, committedMinor: committed }, 'Saved.');
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

function QuoteBox({ plan, onSaved }: { plan: Plan; onSaved: () => void }): React.ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // The extraction becomes an EDITABLE draft (M7.2): the family corrects anything before
  // it is saved; nothing reaches the library unreviewed and no value is invented.
  const [draft, setDraft] = useState<(QuoteFields & { source: string }) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(plan.categories[0]?.id ?? '');

  async function extract() {
    setBusy(true);
    setNotice(null);
    try {
      const reply = await aiClient.extractQuote(text, plan.currency);
      setDraft(reply.body);
    } catch {
      setNotice('Quote reading is unavailable. Add the vendor by hand below.');
    } finally {
      setBusy(false);
    }
  }

  function editDraft(patch: Partial<QuoteFields>): void {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  }

  function save() {
    if (draft === null || categoryId.length === 0) return;
    const { source: _source, ...fields } = draft;
    const stored = saveQuote({ planId: plan.id, categoryId, fields });
    setNotice(
      stored === null
        ? 'The quotation could not be saved (storage refused or is full).'
        : 'Quotation saved — compare it below and accept the best one.',
    );
    if (stored !== null) {
      onSaved();
      setDraft(null);
      setText('');
    }
  }

  return (
    <section className="card" aria-labelledby="quote-title">
      <h2 id="quote-title">Read a vendor quote</h2>
      <p className="muted">
        Paste a WhatsApp or email quote; unstated fields stay empty — nothing is invented.
      </p>
      <label htmlFor="quote-text">Quote text</label>
      <textarea
        id="quote-text"
        maxLength={6000}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <button
        type="button"
        className="primary"
        onClick={() => {
          void extract();
        }}
        disabled={busy || text.trim().length === 0}
      >
        {busy ? 'Reading…' : 'Read the quote'}
      </button>
      {draft !== null && (
        <>
          <ExtractedQuoteView plan={plan} result={draft} />
          <QuoteDraftEditor plan={plan} draft={draft} onEdit={editDraft} />
          <div className="row">
            <div>
              <label htmlFor="quote-category">Which category is this quote for?</label>
              <select
                id="quote-category"
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                }}
              >
                {plan.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="primary" onClick={save}>
              Save quotation
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
              }}
            >
              Discard draft
            </button>
          </div>
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

/** Manual correction of every extracted field before the quotation is saved (M7.2). */
function QuoteDraftEditor({
  plan,
  draft,
  onEdit,
}: {
  plan: Plan;
  draft: QuoteFields;
  onEdit: (patch: Partial<QuoteFields>) => void;
}): React.ReactNode {
  const [total, setTotal] = useState(
    draft.totalPriceMinor === null ? '' : displayMajor(draft.totalPriceMinor, plan),
  );
  const [perPlate, setPerPlate] = useState(
    draft.pricePerPlateMinor === null ? '' : displayMajor(draft.pricePerPlateMinor, plan),
  );
  return (
    <fieldset>
      <legend>Correct anything the reader got wrong (money in {plan.currency})</legend>
      <div className="grid">
        <div>
          <label htmlFor="q-vendor">Vendor name</label>
          <input
            id="q-vendor"
            value={draft.vendorName ?? ''}
            maxLength={80}
            onChange={(event) => {
              onEdit({ vendorName: event.target.value.trim() || null });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-total">Stated total (blank = not stated)</label>
          <input
            id="q-total"
            inputMode="decimal"
            value={total}
            onChange={(event) => {
              setTotal(event.target.value);
              const parsed = parseMajorAmount(event.target.value, plan.currency);
              onEdit({ totalPriceMinor: parsed });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-plate">Per-plate rate (blank = not stated)</label>
          <input
            id="q-plate"
            inputMode="decimal"
            value={perPlate}
            onChange={(event) => {
              setPerPlate(event.target.value);
              const parsed = parseMajorAmount(event.target.value, plan.currency);
              onEdit({ pricePerPlateMinor: parsed });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-min">Guest minimum (blank = not stated)</label>
          <input
            id="q-min"
            inputMode="numeric"
            value={draft.guestMinimum ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value);
              onEdit({
                guestMinimum: Number.isInteger(value) && value >= 0 ? value : null,
              });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-advance">Advance % (blank = not stated)</label>
          <input
            id="q-advance"
            inputMode="numeric"
            value={draft.advancePercent ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value);
              onEdit({
                advancePercent:
                  Number.isInteger(value) && value >= 0 && value <= 100 ? value : null,
              });
            }}
          />
        </div>
        <div>
          <label htmlFor="q-tax">Tax included</label>
          <select
            id="q-tax"
            value={draft.taxIncluded === null ? 'unknown' : draft.taxIncluded ? 'yes' : 'no'}
            onChange={(event) => {
              const value = event.target.value;
              onEdit({ taxIncluded: value === 'unknown' ? null : value === 'yes' });
            }}
          >
            <option value="unknown">Not stated</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div>
          <label htmlFor="q-cancel">Cancellation policy (blank = not stated)</label>
          <input
            id="q-cancel"
            value={draft.cancellationPolicy ?? ''}
            maxLength={300}
            onChange={(event) => {
              onEdit({ cancellationPolicy: event.target.value.trim() || null });
            }}
          />
        </div>
      </div>
    </fieldset>
  );
}

/** The extracted fields, honestly labelled, with the deterministic check list. */
function ExtractedQuoteView({
  plan,
  result,
}: {
  plan: Plan;
  result: QuoteFields & { source: string };
}): React.ReactNode {
  const flags = riskFlags(result, plan);
  const rows: readonly { readonly label: string; readonly value: string }[] = [
    { label: 'Vendor', value: result.vendorName ?? 'Not stated' },
    {
      label: 'Total',
      value: result.totalPriceMinor === null ? 'Not stated' : money(result.totalPriceMinor, plan),
    },
    {
      label: 'Per plate',
      value:
        result.pricePerPlateMinor === null ? 'Not stated' : money(result.pricePerPlateMinor, plan),
    },
    {
      label: 'Guest minimum',
      value: result.guestMinimum === null ? 'Not stated' : String(result.guestMinimum),
    },
    {
      label: 'Advance',
      value: result.advancePercent === null ? 'Not stated' : `${result.advancePercent}%`,
    },
    {
      label: 'Tax included',
      value: result.taxIncluded === null ? 'Not stated' : result.taxIncluded ? 'Yes' : 'No',
    },
    { label: 'Cancellation', value: result.cancellationPolicy ?? 'Not stated' },
  ];
  return (
    <div aria-live="polite">
      <table tabIndex={0}>
        <caption className="visually-hidden">Extracted quote fields</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {flags.length > 0 && (
        <div className="alert">
          <strong>
            <span aria-hidden="true">⚠️</span> Things to check
          </strong>
          <ul>
            {flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted">Read by {result.source} — verify against the original before booking.</p>
    </div>
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

/** Money summary from the engine's own aggregates (M5.4). */
function VendorMoneySummary({ plan, vendor }: { plan: Plan; vendor: Vendor }): React.ReactNode {
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

/** Payment history: every recorded expense for this vendor, with its instalment link. */
function VendorPaymentHistory({ plan, vendor }: { plan: Plan; vendor: Vendor }): React.ReactNode {
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

/** Editable vendor details: name, contact person, phone, email, note (M5.1). */
function VendorEditForm({
  vendor,
  onDone,
}: {
  vendor: Vendor;
  onDone: () => void;
}): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <form
      className="row"
      aria-label={`Edit details for ${vendor.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const outcome = store.apply({
          type: 'vendor/update',
          id: vendor.id,
          name: text(data, 'name'),
          contactPerson: text(data, 'person'),
          phone: text(data, 'phone'),
          email: text(data, 'email'),
          contactNote: text(data, 'note'),
        });
        setNotice(outcome.ok ? 'Details saved.' : (outcome.message ?? 'Details were not saved.'));
        if (outcome.ok) onDone();
      }}
    >
      <div>
        <label htmlFor={`${vendor.id}-ed-name`}>Vendor name</label>
        <input
          id={`${vendor.id}-ed-name`}
          name="name"
          defaultValue={vendor.name}
          required
          maxLength={80}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-person`}>Contact person</label>
        <input
          id={`${vendor.id}-ed-person`}
          name="person"
          defaultValue={vendor.contactPerson}
          maxLength={120}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-phone`}>Phone</label>
        <input
          id={`${vendor.id}-ed-phone`}
          name="phone"
          type="tel"
          defaultValue={vendor.phone}
          maxLength={40}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-email`}>Email</label>
        <input
          id={`${vendor.id}-ed-email`}
          name="email"
          type="email"
          defaultValue={vendor.email}
          maxLength={120}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-note`}>Contact note</label>
        <input
          id={`${vendor.id}-ed-note`}
          name="note"
          defaultValue={vendor.contactNote}
          maxLength={500}
        />
      </div>
      <button type="submit" className="primary">
        Save details
      </button>
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </form>
  );
}
