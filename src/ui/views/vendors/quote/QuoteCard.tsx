import type { Plan } from '../../../../engine/types';
import { money } from '../../../../lib/format';
import {
  effectiveMinor,
  inquiryMessage,
  missingFields,
  riskFlags,
} from '../../../../lib/quoteCompare';
import type { SavedQuote } from '../../../../state/quotes';

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
        value: statedText(fields.totalPriceMinor, (total) => money(total, plan)),
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
        value: yesNoLabel(fields.taxIncluded),
      },
      {
        label: 'Min. guests',
        value: statedText(fields.guestMinimum, String),
      },
    ],
  };
}

/** "Not stated" for optional values; shared wording across the comparison rows. */
function statedText<T>(value: T | null, render: (value: T) => string): string {
  return value === null ? 'Not stated' : render(value);
}

function yesNoLabel(value: boolean | null): string {
  return value === null ? 'Not stated' : value ? 'Yes' : 'No';
}

const QUOTE_STATUS_LABELS: Readonly<Record<SavedQuote['status'], string>> = {
  review: 'Under review',
  shortlisted: 'Shortlisted',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

/** Missing fields and the deterministic check list, shown before acceptance. */
function QuoteAlerts({ missing, flags }: { missing: readonly string[]; flags: readonly string[] }) {
  return (
    <>
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
    </>
  );
}

/** The status picker; 'accepted' stays reachable only through the engine-gated Accept. */
function QuoteStatusSelect({
  quote,
  onStatus,
}: {
  quote: SavedQuote;
  onStatus: (status: SavedQuote['status']) => void;
}) {
  return (
    <>
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
    </>
  );
}

/** Vendor name, category, saved date, status badge and the expired- validity badge. */
function QuoteCardHeader({ quote, category }: { quote: SavedQuote; category: string | undefined }) {
  return (
    <>
      <h3>{quote.fields.vendorName ?? 'Unnamed vendor'}</h3>
      <p className="muted">
        {category ?? 'Unknown category'} · saved {quote.savedAtISO.slice(0, 10)}
      </p>
      <p>
        <span className={`badge ${quote.status === 'accepted' ? 'success' : ''}`}>
          <span aria-hidden="true">{quote.status === 'accepted' ? '✓' : '•'}</span>{' '}
          {QUOTE_STATUS_LABELS[quote.status]}
        </span>
        {quote.validityDate !== null &&
          quote.validityDate < new Date().toLocaleDateString('sv-SE') && (
            <span className="badge error">
              <span aria-hidden="true">!</span> Validity passed {quote.validityDate}
            </span>
          )}
      </p>
    </>
  );
}

export function QuoteCard({
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
  const { rows, effective, flags, missing } = quoteCardRows(plan, quote);
  const category = plan.categories.find((c) => c.id === quote.categoryId);

  return (
    <div
      className="card"
      style={{ flex: '1 1 260px' }}
      aria-label={`Quotation from ${quote.fields.vendorName ?? 'unknown vendor'}`}
    >
      <QuoteCardHeader quote={quote} category={category?.name} />
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
      <QuoteAlerts missing={missing} flags={flags} />
      <details>
        <summary>Draft an inquiry about the missing terms</summary>
        <textarea
          readOnly
          rows={5}
          value={inquiryMessage(quote.fields, missing)}
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
        <QuoteStatusSelect quote={quote} onStatus={onStatus} />
        <button type="button" className="subtle" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
