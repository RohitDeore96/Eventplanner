import type { Plan } from '../../../../engine/types';
import { ExtractedQuoteView } from './ExtractedQuoteView';
import { QuoteDraftEditor } from './QuoteDraftEditor';
import { useQuoteDraft } from './useQuoteDraft';

/** Paste a vendor quote, let the model read it, correct it, then save it to the library. */
export function QuoteBox({ plan, onSaved }: { plan: Plan; onSaved: () => void }): React.ReactNode {
  const draftState = useQuoteDraft(plan, onSaved);
  const { text, setText, busy, draft, setDraft, notice, categoryId, setCategoryId } = draftState;
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
          void draftState.extract();
        }}
        disabled={busy || text.trim().length === 0}
      >
        {busy ? 'Reading…' : 'Read the quote'}
      </button>
      {draft !== null && (
        <>
          <ExtractedQuoteView plan={plan} result={draft} />
          <QuoteDraftEditor plan={plan} draft={draft} onEdit={draftState.editDraft} />
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
            <button type="button" className="primary" onClick={draftState.save}>
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
