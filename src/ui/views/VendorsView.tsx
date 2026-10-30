import { useState } from 'react';
import type { PlanAction } from '../../engine/actions';
import { parseMajorAmount } from '../../engine/money';
import type { BookingStatus, Plan } from '../../engine/types';
import { money } from '../../lib/format';
import { aiClient } from '../../lib/aiClient';
import { usePlan } from '../../state/store';
import { text } from './form';

const STATUS_OPTIONS: readonly { readonly value: BookingStatus; readonly label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'quoted', label: 'Quotation received' },
  { value: 'booked', label: 'Booked' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Per-category vendor checklist: which vendor types to book, with booking status and payment schedule. */
export function VendorsView({ plan }: { plan: Plan }): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);

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

      <QuoteBox plan={plan} />

      {plan.vendors.length > 0 && (
        <section className="card" aria-labelledby="vendors-title">
          <h2 id="vendors-title">Your vendors</h2>
          <table>
            <caption className="visually-hidden">Vendors with status and agreed price</caption>
            <thead>
              <tr>
                <th scope="col">Vendor</th>
                <th scope="col">Category</th>
                <th scope="col">Status</th>
                <th scope="col">Agreed</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.vendors.map((vendor) => (
                <tr key={vendor.id}>
                  <th scope="row">{vendor.name}</th>
                  <td>{plan.categories.find((c) => c.id === vendor.categoryId)?.name ?? '—'}</td>
                  <td>
                    <select
                      aria-label={`Status for ${vendor.name}`}
                      value={vendor.status}
                      onChange={(event) =>
                        store.apply({
                          type: 'vendor/update',
                          id: vendor.id,
                          status: event.target.value as BookingStatus,
                        })
                      }
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {vendor.committedMinor === null ? '—' : money(vendor.committedMinor, plan)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="subtle"
                      onClick={() => {
                        store.apply({ type: 'vendor/delete', id: vendor.id });
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Payment schedules per vendor come next (M2 close-out): instalments, advances and balance
            tracking, with overdue warnings on the timeline.
          </p>
        </section>
      )}
    </>
  );
}

interface ExtractedQuote {
  readonly guestMinimum: number | null;
  readonly taxIncluded: boolean | null;
  readonly advancePercent: number | null;
  readonly cancellationPolicy: string | null;
}

/** Deterministic checks the engine can make against the pasted quote. */
function quoteFlags(result: ExtractedQuote | null, plan: Plan): string[] {
  if (result === null) return [];
  const flags: string[] = [];
  if (result.guestMinimum !== null && result.guestMinimum > plan.guestTarget) {
    flags.push(`Minimum ${result.guestMinimum} plates is above your ${plan.guestTarget} guests.`);
  }
  if (result.taxIncluded === null) flags.push('The quote does not say whether tax is included.');
  if (result.advancePercent !== null && result.advancePercent > 50) {
    flags.push(`Advance ${result.advancePercent}% is high (above 50%).`);
  }
  if (result.cancellationPolicy === null) flags.push('No cancellation policy stated.');
  return flags;
}

function QuoteBox({ plan }: { plan: Plan }): React.ReactNode {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    vendorName: string | null;
    totalPriceMinor: number | null;
    pricePerPlateMinor: number | null;
    guestMinimum: number | null;
    advancePercent: number | null;
    taxIncluded: boolean | null;
    cancellationPolicy: string | null;
    source: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const flags = quoteFlags(result, plan);

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
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {result !== null && (
        <div aria-live="polite">
          <table>
            <caption className="visually-hidden">Extracted quote fields</caption>
            <tbody>
              <tr>
                <th scope="row">Vendor</th>
                <td>{result.vendorName ?? 'Not stated'}</td>
              </tr>
              <tr>
                <th scope="row">Total</th>
                <td>
                  {result.totalPriceMinor === null
                    ? 'Not stated'
                    : money(result.totalPriceMinor, plan)}
                </td>
              </tr>
              <tr>
                <th scope="row">Per plate</th>
                <td>
                  {result.pricePerPlateMinor === null
                    ? 'Not stated'
                    : money(result.pricePerPlateMinor, plan)}
                </td>
              </tr>
              <tr>
                <th scope="row">Guest minimum</th>
                <td>{result.guestMinimum ?? 'Not stated'}</td>
              </tr>
              <tr>
                <th scope="row">Advance</th>
                <td>
                  {result.advancePercent === null ? 'Not stated' : `${result.advancePercent}%`}
                </td>
              </tr>
              <tr>
                <th scope="row">Tax included</th>
                <td>
                  {result.taxIncluded === null ? 'Not stated' : result.taxIncluded ? 'Yes' : 'No'}
                </td>
              </tr>
              <tr>
                <th scope="row">Cancellation</th>
                <td>{result.cancellationPolicy ?? 'Not stated'}</td>
              </tr>
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
          <p className="muted">
            Read by {result.source} — verify against the original before booking.
          </p>
        </div>
      )}
    </section>
  );
}
