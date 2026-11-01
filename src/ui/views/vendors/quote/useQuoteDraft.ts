import { useState } from 'react';
import type { QuoteFields } from '../../../../schemas/ai';
import { aiClient } from '../../../../lib/aiClient';
import { saveQuote } from '../../../../state/quotes';
import type { Plan } from '../../../../engine/types';

/**
 * The whole read-a-quote lifecycle: pasted text, the busy flag, the editable draft,
 * the notice and the target category. Extracted from QuoteBox so the component renders
 * while the draft state machine lives in one testable place.
 */
export function useQuoteDraft(
  plan: Plan,
  onSaved: () => void,
): {
  readonly text: string;
  readonly setText: (value: string) => void;
  readonly busy: boolean;
  readonly draft: (QuoteFields & { source: string }) | null;
  readonly setDraft: (draft: (QuoteFields & { source: string }) | null) => void;
  readonly notice: string | null;
  readonly categoryId: string;
  readonly setCategoryId: (categoryId: string) => void;
  readonly extract: () => Promise<void>;
  readonly editDraft: (patch: Partial<QuoteFields>) => void;
  readonly save: () => void;
} {
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

  return {
    text,
    setText,
    busy,
    draft,
    setDraft,
    notice,
    categoryId,
    setCategoryId,
    extract,
    editDraft,
    save,
  };
}
