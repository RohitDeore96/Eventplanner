import type { Plan } from '../../../../engine/types';
import { QUOTE_STATUSES, type SavedQuote } from '../../../../state/quotes';
import { parseEnum } from '../../form';
import { quoteCardRows } from './quoteCardRows';

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
          // Proven before it is typed: the select is user input.
          const value = parseEnum(event.target.value, QUOTE_STATUSES);
          if (value !== null && value !== quote.status) onStatus(value);
        }}
      >
        {QUOTE_STATUSES
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
  const { rows, effective, flags, missing, inquiry } = quoteCardRows(plan, quote);
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
        <textarea readOnly rows={5} value={inquiry} aria-label="Draft inquiry message" />
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
