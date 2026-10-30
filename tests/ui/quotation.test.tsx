/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest';
import { deleteQuote, loadQuotes, saveQuote, type SavedQuote } from '../../src/state/quotes';
import {
  acceptActions,
  effectiveMinor,
  inquiryMessage,
  missingFields,
  riskFlags,
} from '../../src/lib/quoteCompare';
import { reducePlan } from '../../src/engine/reducer';
import { budgetTotals } from '../../src/engine/budget';
import { makePlan, TODAY } from '../helpers';
import type { QuoteFields } from '../../src/schemas/ai';

/**
 * PRIORITY 2 acceptance: quotations can be saved, compared side by side, and accepted — and
 * an accepted quotation updates the financial engine (vendor booked at the effective price),
 * not just a visual flag. The library itself is untrusted input and must re-validate on load.
 */

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getLength: 0,
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => map.delete(key),
    setItem: (key: string, value: string) => map.set(key, value),
  } as unknown as Storage;
}

const fullFields: QuoteFields = {
  vendorName: 'Sharma Caterers',
  category: 'catering',
  totalPriceMinor: 8_000_000,
  pricePerPlateMinor: null,
  guestMinimum: 100,
  overtimeFeePerHourMinor: null,
  taxIncluded: true,
  advancePercent: 30,
  cancellationPolicy: '50% refund up to 2 weeks before',
  inclusions: ['Welcome drinks'],
  exclusions: [],
};

describe('quotation library (P2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads quotations per plan, surviving a reload', () => {
    const storage = memoryStorage();
    const saved = saveQuote(
      { planId: 'p1', categoryId: 'c-catering', fields: fullFields },
      storage,
    );
    expect(saved).not.toBeNull();
    saveQuote({ planId: 'p2', categoryId: 'c-catering', fields: fullFields }, storage);
    const forP1 = loadQuotes('p1', storage);
    expect(forP1).toHaveLength(1);
    expect(forP1[0]?.fields.vendorName).toBe('Sharma Caterers');
  });

  it('rejects corrupted or tampered library records instead of trusting them', () => {
    const storage = memoryStorage();
    storage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 1,
        quotes: [
          { id: 'x', planId: 'p1', categoryId: 'c', savedAtISO: 'nope', fields: { evil: true } },
        ],
      }),
    );
    expect(loadQuotes('p1', storage)).toEqual([]);
    storage.setItem('utsav.quotes.v1', '{not json');
    expect(loadQuotes('p1', storage)).toEqual([]);
  });

  it('removes a quotation and keeps the rest', () => {
    const storage = memoryStorage();
    const a = saveQuote({ planId: 'p1', categoryId: 'c', fields: fullFields }, storage);
    const b = saveQuote({ planId: 'p1', categoryId: 'c', fields: fullFields }, storage);
    if (a === null || b === null) throw new Error('save failed');
    deleteQuote(a.id, storage);
    const left = loadQuotes('p1', storage);
    expect(left).toHaveLength(1);
    expect(left[0]?.id).toBe(b.id);
  });
});

describe('quotation comparison and acceptance (P2)', () => {
  const plan = makePlan();
  const cateringCategory = plan.categories.find((c) => c.key === 'catering');
  if (cateringCategory === undefined) throw new Error('no catering category in fixture');

  function quote(over: Partial<QuoteFields>): SavedQuote {
    // Narrow inside the closure: TS does not carry the outer guard into function bodies.
    const categoryId = cateringCategory?.id;
    if (categoryId === undefined) throw new Error('no catering category in fixture');
    return {
      id: 'q1',
      planId: plan.id,
      categoryId,
      savedAtISO: '2026-10-30T00:00:00.000Z',
      fields: { ...fullFields, ...over },
    };
  }

  function applyAll(start: typeof plan, actions: ReturnType<typeof acceptActions>): typeof plan {
    return (actions ?? []).reduce((current, action) => {
      const next = reducePlan(current, action, { today: TODAY });
      if (!next.ok) throw new Error(next.error.message);
      return next.value;
    }, start);
  }

  it('computes the effective price: per-plate × guests, else the stated total', () => {
    expect(effectiveMinor(fullFields, plan.guestTarget)).toBe(8_000_000);
    expect(
      effectiveMinor(
        quote({ totalPriceMinor: null, pricePerPlateMinor: 50_000 }).fields,
        plan.guestTarget,
      ),
    ).toBe(50_000 * plan.guestTarget);
    expect(
      effectiveMinor(
        quote({ totalPriceMinor: null, pricePerPlateMinor: null }).fields,
        plan.guestTarget,
      ),
    ).toBeNull();
  });

  it('lists missing fields and risk flags honestly', () => {
    const sparse = quote({
      guestMinimum: null,
      cancellationPolicy: null,
      taxIncluded: false,
      advancePercent: 60,
    });
    const missing = missingFields(sparse.fields);
    expect(missing).toContain('minimum guests');
    expect(missing).toContain('cancellation policy');
    const flags = riskFlags(sparse.fields, plan);
    expect(flags.some((flag) => flag.includes('60%'))).toBe(true);
    expect(flags.some((flag) => flag.includes('GST'))).toBe(true);
  });

  it('drafts a specific inquiry message about exactly the missing terms', () => {
    const message = inquiryMessage(quote({ cancellationPolicy: null }).fields, [
      'cancellation policy',
    ]);
    expect(message).toContain('cancellation policy');
    expect(message).toContain('Sharma Caterers');
  });

  it('accepting a quotation books the vendor at the effective price through the engine', () => {
    const saved = quote({});
    const actions = acceptActions(plan, saved);
    if (actions === null) throw new Error('acceptActions returned null for a priced quote');
    const accepted = applyAll(plan, actions);
    const vendor = accepted.vendors.find((v) => v.name === 'Sharma Caterers');
    expect(vendor?.status).toBe('booked');
    expect(vendor?.committedMinor).toBe(8_000_000);
    // Committed now includes the accepted quote; cash still to pay reflects it.
    const totals = budgetTotals(accepted);
    expect(totals.committed).toBeGreaterThanOrEqual(8_000_000);
  });

  it('accepting again updates the same vendor instead of duplicating it', () => {
    const saved = quote({});
    const first = acceptActions(plan, saved);
    if (first === null) throw new Error('acceptActions returned null');
    const afterFirst = applyAll(plan, first);
    const second = acceptActions(afterFirst, saved);
    if (second === null) throw new Error('acceptActions returned null');
    const afterSecond = applyAll(afterFirst, second);
    expect(afterSecond.vendors.filter((v) => v.name === 'Sharma Caterers')).toHaveLength(1);
  });

  it('refuses to accept a quote for a category that does not exist', () => {
    const bogus: SavedQuote = { ...quote({}), categoryId: 'ghost' };
    expect(acceptActions(plan, bogus)).toBeNull();
  });
});
