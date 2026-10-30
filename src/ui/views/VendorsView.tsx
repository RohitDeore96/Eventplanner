import { useMemo, useState } from 'react';
import type { PlanAction } from '../../engine/actions';
import { instalmentPayments } from '../../engine/budget';
import { currencyExponent, parseMajorAmount } from '../../engine/money';
import type { BookingStatus, Instalment, PaymentKind, Plan, Vendor } from '../../engine/types';
import { PAYMENT_KINDS } from '../../engine/enums';
import type { QuoteFields } from '../../schemas/ai';
import { money } from '../../lib/format';
import { aiClient } from '../../lib/aiClient';
import { usePlan } from '../../state/store';
import { deleteQuote, loadQuotes, saveQuote, type SavedQuote } from '../../state/quotes';
import {
  acceptActions,
  effectiveMinor,
  inquiryMessage,
  missingFields,
  riskFlags,
} from '../../lib/quoteCompare';
import { text } from './form';
/** Minor -> major for small inline inputs, with the plan currency's own exponent. */
function displayMajor(minor: number, plan: Plan): string {
  const exponent = currencyExponent(plan.currency) ?? 2;
  return String(Math.round(minor / 10 ** exponent));
}

const STATUS_OPTIONS: readonly { readonly value: BookingStatus; readonly label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'quoted', label: 'Quotation received' },
  { value: 'booked', label: 'Booked' },
  { value: 'cancelled', label: 'Cancelled' },
];

const KIND_LABELS: Record<PaymentKind, string> = {
  advance: 'Advance',
  instalment: 'Instalment',
  milestone: 'Milestone',
  final: 'Final payment',
  balance: 'Balance',
  custom: 'Custom',
};

/** Per-category vendor checklist: which vendor types to book, with booking status. */
export function VendorsView({ plan }: { plan: Plan }): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);
  // Saved quotations live outside the plan; this counter re-reads the library after changes.
  const [quotesVersion, setQuotesVersion] = useState(0);
  const refreshQuotes = (): void => {
    setQuotesVersion((version) => version + 1);
  };

  return (
    <>
      <section className="card" aria-labelledby="checklist-title">
        <h2 id="checklist-title">Booking checklist</h2>
        <table>
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
          <h2 id="vendors-title">Your vendors</h2>
          {plan.vendors.map((vendor) => (
            <VendorCard key={vendor.id} plan={plan} vendor={vendor} />
          ))}
        </section>
      )}
    </>
  );
}

/** One vendor: booking details, payment schedule, and recording payments against instalments. */
function VendorCard({ plan, vendor }: { plan: Plan; vendor: Vendor }): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);
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
            apply({ type: 'vendor/delete', id: vendor.id }, 'Vendor removed.');
          }}
        >
          Remove
        </button>
      </div>

      <h4>Payment schedule</h4>
      {vendor.schedule.length === 0 ? (
        <p className="muted">
          No scheduled payments yet. Add the advance and final payment below — they show up as
          overdue warnings and settle only when real payments are recorded.
        </p>
      ) : (
        <table>
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
      {notice !== null && notice.length > 0 && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

function InstalmentRow({
  plan,
  vendor,
  instalment,
  paid,
}: {
  plan: Plan;
  vendor: Vendor;
  instalment: Instalment;
  paid: number;
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
          /* key re-mounts the form when the outstanding balance changes, so the
             pre-filled amount is never a stale number from a previous render. */
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
        )}
      </td>
    </tr>
  );
}

function AddInstalmentForm({
  plan,
  vendor,
  onAdd,
}: {
  plan: Plan;
  vendor: Vendor;
  onAdd: (instalment: Instalment) => void;
}): React.ReactNode {
  // Controlled inputs: the values survive re-renders predictably and clear exactly on add.
  const [kind, setKind] = useState<PaymentKind>('advance');
  const [due, setDue] = useState('');
  const [amount, setAmount] = useState('');
  return (
    <form
      className="row"
      aria-label={`Add a scheduled payment for ${vendor.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        const amountMinor = parseMajorAmount(amount.trim(), plan.currency);
        if (amountMinor === null || due.length === 0) return;
        onAdd({
          id: `i-${Date.now().toString(36)}`,
          kind,
          dueISO: due,
          amountMinor,
        });
        setKind('advance');
        setDue('');
        setAmount('');
      }}
    >
      <div>
        <label htmlFor={`${vendor.id}-kind`}>Add payment</label>
        <select
          id={`${vendor.id}-kind`}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as PaymentKind);
          }}
        >
          {PAYMENT_KINDS.map((option) => (
            <option key={option} value={option}>
              {KIND_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${vendor.id}-due`}>Due date</label>
        <input
          id={`${vendor.id}-due`}
          type="date"
          required
          value={due}
          onChange={(event) => {
            setDue(event.target.value);
          }}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-amount`}>Amount</label>
        <input
          id={`${vendor.id}-amount`}
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>
      <button type="submit">Add to schedule</button>
    </form>
  );
}

function QuoteBox({ plan, onSaved }: { plan: Plan; onSaved: () => void }): React.ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(QuoteFields & { source: string }) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState(plan.categories[0]?.id ?? '');

  async function extract() {
    setBusy(true);
    setNotice(null);
    try {
      const reply = await aiClient.extractQuote(text);
      setResult(reply.body);
    } catch {
      setNotice('Quote reading is unavailable. Add the vendor by hand below.');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (result === null || categoryId.length === 0) return;
    const { source: _source, ...fields } = result;
    const stored = saveQuote({ planId: plan.id, categoryId, fields });
    setNotice(
      stored === null
        ? 'The quotation could not be saved (storage refused or is full).'
        : 'Quotation saved — compare it below and accept the best one.',
    );
    if (stored !== null) onSaved();
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
      {result !== null && (
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
          <button type="button" onClick={save}>
            Save quotation
          </button>
        </div>
      )}
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {result !== null && <ExtractedQuoteView plan={plan} result={result} />}
    </section>
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
      <table>
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
    const actions = acceptActions(plan, quote);
    if (actions === null) {
      setNotice(
        'This quote states neither a total nor a per-plate rate, so it cannot be accepted.',
      );
      return;
    }
    let failed: string | null = null;
    for (const action of actions) {
      const outcome = store.apply(action);
      if (!outcome.ok) {
        failed = outcome.message ?? 'The quotation could not be accepted.';
        break;
      }
    }
    setNotice(
      failed ??
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

function QuoteCard({
  plan,
  quote,
  onAccept,
  onRemove,
}: {
  plan: Plan;
  quote: SavedQuote;
  onAccept: () => void;
  onRemove: () => void;
}): React.ReactNode {
  const fields = quote.fields;
  const { rows, effective, flags, missing } = quoteCardRows(plan, quote);
  const category = plan.categories.find((c) => c.id === quote.categoryId);

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
      <table>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
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
        <button type="button" className="primary" onClick={onAccept} disabled={effective === null}>
          Accept this quotation
        </button>
        <button type="button" className="subtle" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
