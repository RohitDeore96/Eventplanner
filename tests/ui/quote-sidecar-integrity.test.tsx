/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePlan, TODAY } from '../helpers';
import { initPlanState, planReducer } from '../../src/state/planState';
import { usePlanStore } from '../../src/state/store';
import {
  loadQuotes,
  onQuotesChanged,
  saveQuote,
  setQuoteStatus,
  updateQuote,
  type SavedQuote,
} from '../../src/state/quotes';
import type { QuoteFields } from '../../src/schemas/ai';
import type { Plan } from '../../src/engine/types';

/**
 * Quotation sidecar integrity (code-quality fixes):
 * - the library cap refuses a save instead of silently discarding the oldest quotation;
 * - a larger-than-cap file from an older/foreign writer still loads (no data destruction);
 * - accepting a quotation folds the sidecar status into the plan's undo step, so Undo
 *   reverts both and Redo re-applies both — the accepted badge can no longer outlive the
 *   booking it came from.
 */

const plan: Plan = makePlan();

function fieldsFor(vendorName: string): QuoteFields {
  return {
    vendorName,
    category: null,
    totalPriceMinor: 2_500_000,
    pricePerPlateMinor: null,
    guestMinimum: null,
    overtimeFeePerHourMinor: null,
    taxIncluded: null,
    advancePercent: null,
    cancellationPolicy: null,
    inclusions: [],
    exclusions: [],
  };
}

function rawLibrary(): { schemaVersion: number; quotes: SavedQuote[] } {
  const raw = window.localStorage.getItem('utsav.quotes.v1');
  if (raw === null) throw new Error('quotes file missing');
  return JSON.parse(raw) as { schemaVersion: number; quotes: SavedQuote[] };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('quotation library cap (no silent drop)', () => {
  it('refuses the 25th save with an honest null and keeps every existing quote', () => {
    for (let i = 1; i <= 24; i += 1) {
      expect(
        saveQuote({ planId: 'ev1', categoryId: 'c1', fields: fieldsFor(`V${i}`) }),
      ).not.toBeNull();
    }
    const oldestBefore = loadQuotes('ev1')[23]; // oldest sits last (newest are prepended)
    expect(oldestBefore?.fields.vendorName).toBe('V1');
    // The full-library save is refused instead of dropping V1.
    expect(saveQuote({ planId: 'ev1', categoryId: 'c1', fields: fieldsFor('V25') })).toBeNull();
    const after = loadQuotes('ev1');
    expect(after).toHaveLength(24);
    expect(after.some((quote) => quote.fields.vendorName === 'V1')).toBe(true);
    expect(after.some((quote) => quote.fields.vendorName === 'V25')).toBe(false);
    // Freeing one slot makes saving work again.
    const freed = after[0];
    if (freed === undefined) throw new Error('fixture failed');
    window.localStorage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 2,
        quotes: rawLibrary().quotes.filter((quote) => quote.id !== freed.id),
      }),
    );
    expect(saveQuote({ planId: 'ev1', categoryId: 'c1', fields: fieldsFor('V25') })).not.toBeNull();
  });

  it('loads a library with more than 24 records instead of destroying it at parse time', () => {
    for (let i = 1; i <= 24; i += 1) {
      saveQuote({ planId: 'ev1', categoryId: 'c1', fields: fieldsFor(`V${i}`) });
    }
    // Simulate a foreign/older writer that stored more than the current product cap.
    const file = rawLibrary();
    const first = file.quotes[0];
    if (first === undefined) throw new Error('fixture failed');
    const extra = [1, 2].map((n) => ({
      ...first,
      id: `foreign-${n}`,
      fields: { ...first.fields, vendorName: `Foreign ${n}` },
    }));
    window.localStorage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({ schemaVersion: 2, quotes: [...file.quotes, ...extra] }),
    );
    expect(loadQuotes('ev1')).toHaveLength(26);
  });

  it('reports an unknown id from updateQuote instead of writing a no-op success', () => {
    const saved = saveQuote({ planId: 'ev1', categoryId: 'c1', fields: fieldsFor('V1') });
    expect(saved).not.toBeNull();
    expect(updateQuote('nope', { note: 'x' })).toBe(false);
    expect(loadQuotes('ev1')[0]?.note).toBe('');
  });

  it('notifies subscribers after writes and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = onQuotesChanged(listener);
    const saved = saveQuote({ planId: 'ev1', categoryId: 'c1', fields: fieldsFor('V1') });
    expect(listener).toHaveBeenCalledTimes(1);
    if (saved === null) throw new Error('fixture failed');
    setQuoteStatus(saved.id, 'shortlisted');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setQuoteStatus(saved.id, 'review');
    expect(listener).toHaveBeenCalledTimes(2); // unchanged after unsubscribe
  });
});

describe('accepted quotation and Undo/Redo move together', () => {
  it('threads the quote reference onto the batch activity entry (pure reducer)', () => {
    const state = planReducer(
      initPlanState(plan),
      {
        kind: 'applyAll',
        actions: [{ type: 'event/update', changes: { name: 'Renamed' } }],
        label: 'Quotation accepted — Sharma Caterers booked',
        quote: { id: 'q1', previousStatus: 'shortlisted' },
      },
      TODAY,
    );
    expect(state.lastError).toBeNull();
    expect(state.log.at(-1)?.quote).toEqual({ id: 'q1', previousStatus: 'shortlisted' });
  });

  it('undo restores the previous sidecar status; redo re-applies accepted', () => {
    const saved = saveQuote({
      planId: plan.id,
      categoryId: 'catering',
      fields: fieldsFor('Sharma Caterers'),
    });
    if (saved === null) throw new Error('fixture failed');
    expect(setQuoteStatus(saved.id, 'shortlisted')).toBe(true);

    const { result } = renderHook(() => usePlanStore(TODAY, plan));
    let outcome: { ok: boolean; message: string | null } | undefined;
    act(() => {
      outcome = result.current.applyAll(
        [{ type: 'event/update', changes: { name: 'Renamed' } }],
        'Quotation accepted — Sharma Caterers booked',
        { id: saved.id, previousStatus: 'shortlisted' },
      );
    });
    expect(outcome?.ok).toBe(true);
    expect(loadQuotes(plan.id)[0]?.status).toBe('shortlisted'); // set by accept() after applyAll

    act(() => {
      setQuoteStatus(saved.id, 'accepted');
    });

    act(() => {
      result.current.undo();
    });
    // The plan reverted...
    expect(result.current.state.history.present.name).toBe('Asha & Dev wedding');
    // ...and the sidecar status went back with it (no stuck "accepted" guard).
    expect(loadQuotes(plan.id)[0]?.status).toBe('shortlisted');

    act(() => {
      result.current.redo();
    });
    expect(result.current.state.history.present.name).toBe('Renamed');
    expect(loadQuotes(plan.id)[0]?.status).toBe('accepted');
  });

  it('leaves the sidecar untouched when undoing an entry without a quote reference', () => {
    const saved = saveQuote({ planId: plan.id, categoryId: 'catering', fields: fieldsFor('V1') });
    if (saved === null) throw new Error('fixture failed');
    expect(setQuoteStatus(saved.id, 'shortlisted')).toBe(true);

    const { result } = renderHook(() => usePlanStore(TODAY, plan));
    act(() => {
      result.current.apply({ type: 'event/update', changes: { name: 'Renamed' } });
    });
    act(() => {
      result.current.undo();
    });
    expect(loadQuotes(plan.id)[0]?.status).toBe('shortlisted');
  });

  it('does not crash when the reverted quote was deleted in the meantime', () => {
    const saved = saveQuote({ planId: plan.id, categoryId: 'catering', fields: fieldsFor('V1') });
    if (saved === null) throw new Error('fixture failed');
    const { result } = renderHook(() => usePlanStore(TODAY, plan));
    act(() => {
      result.current.applyAll(
        [{ type: 'event/update', changes: { name: 'Renamed' } }],
        'accepted',
        {
          id: saved.id,
          previousStatus: 'review',
        },
      );
    });
    setQuoteStatus(saved.id, 'accepted');
    window.localStorage.clear(); // the quote disappeared (another tab, event delete, ...)
    expect(() => {
      act(() => {
        result.current.undo();
      });
    }).not.toThrow();
    expect(result.current.state.history.present.name).toBe('Asha & Dev wedding');
  });
});

/**
 * Regression tests (targeted bug-fix audit): Undo and Redo must move the sidecar status
 * only when the plan history transition actually succeeds. A redo whose step was cleared
 * by a fresh change is a no-op — the store must not fish a reverted quotation out of the
 * log and mark it accepted without restoring the vendor booking it stands for.
 */
describe('no-op Undo/Redo cannot move the sidecar (regression)', () => {
  it('does not mark an old quotation accepted when Redo has nothing to redo', () => {
    // 1. Accept a quotation (batch entry carries the quote reference).
    const saved = saveQuote({
      planId: plan.id,
      categoryId: 'catering',
      fields: fieldsFor('Sharma Caterers'),
    });
    if (saved === null) throw new Error('fixture failed');
    expect(setQuoteStatus(saved.id, 'shortlisted')).toBe(true);
    const { result } = renderHook(() => usePlanStore(TODAY, plan));
    act(() => {
      result.current.applyAll(
        [{ type: 'event/update', changes: { name: 'Renamed' } }],
        'Quotation accepted — Sharma Caterers booked',
        { id: saved.id, previousStatus: 'shortlisted' },
      );
    });
    act(() => {
      setQuoteStatus(saved.id, 'accepted');
    });
    // 2. Undo the acceptance: plan reverted, sidecar back to shortlisted.
    act(() => {
      result.current.undo();
    });
    expect(result.current.state.history.present.name).toBe('Asha & Dev wedding');
    expect(loadQuotes(plan.id)[0]?.status).toBe('shortlisted');
    // 3. A different event change lands — the redo step is gone for good.
    act(() => {
      result.current.apply({ type: 'event/update', changes: { name: 'Second change' } });
    });
    expect(result.current.state.history.future).toHaveLength(0);
    // 4. Redo: nothing to redo, so neither the plan nor the sidecar may move.
    act(() => {
      result.current.redo();
    });
    expect(result.current.state.history.present.name).toBe('Second change');
    expect(loadQuotes(plan.id)[0]?.status).toBe('shortlisted');
    const acceptEntry = result.current.state.log.find((entry) => entry.quote !== undefined);
    expect(acceptEntry?.reverted).toBe(true); // still struck: it was never re-applied
  });

  it('leaves the log untouched when Undo has nothing to undo (pure reducer)', () => {
    const state = planReducer(
      initPlanState(plan),
      { kind: 'apply', action: { type: 'event/update', changes: { name: 'Renamed' } } },
      TODAY,
    );
    const emptied = planReducer(state, { kind: 'undo' }, TODAY);
    const noopUndo = planReducer(emptied, { kind: 'undo' }, TODAY); // the stack is empty now
    // A no-op undo must not strike a log line the plan did not actually revert.
    expect(noopUndo.log.filter((entry) => !entry.reverted).length).toBe(
      emptied.log.filter((entry) => !entry.reverted).length,
    );
    expect(noopUndo.history.present).toBe(emptied.history.present);
  });

  it('leaves the log untouched when Redo has nothing to redo (pure reducer)', () => {
    const state = planReducer(
      initPlanState(plan),
      { kind: 'apply', action: { type: 'event/update', changes: { name: 'Renamed' } } },
      TODAY,
    );
    const undone = planReducer(state, { kind: 'undo' }, TODAY);
    // A fresh change clears the redo step…
    const changed = planReducer(
      undone,
      { kind: 'apply', action: { type: 'event/update', changes: { name: 'Again' } } },
      TODAY,
    );
    expect(changed.history.future).toHaveLength(0);
    // …so redo is a no-op and the undone entry must stay struck.
    const noopRedo = planReducer(changed, { kind: 'redo' }, TODAY);
    expect(noopRedo.log.filter((entry) => entry.reverted).length).toBe(
      changed.log.filter((entry) => entry.reverted).length,
    );
    expect(noopRedo.history.present).toBe(changed.history.present);
  });
});
