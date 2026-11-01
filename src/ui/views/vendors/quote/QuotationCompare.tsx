import { useMemo, useState } from 'react';
import type { Plan } from '../../../../engine/types';
import { acceptActions } from '../../../../lib/quoteCompare';
import { usePlan } from '../../../../state/store';
import {
  deleteQuote,
  loadQuotes,
  setQuoteStatus,
  updateQuote,
  type SavedQuote,
} from '../../../../state/quotes';
import { QuoteCard } from './QuoteCard';

/**
 * Saved quotations, side by side. Comparison is deterministic; acceptance goes through the
 * engine so committed totals, warnings and undo behave like every other change.
 */
export function QuotationCompare({
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
