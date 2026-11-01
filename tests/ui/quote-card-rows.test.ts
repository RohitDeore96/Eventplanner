import { describe, expect, it } from 'vitest';
import { makePlan } from '../helpers';
import type { SavedQuote } from '../../src/state/quotes';
import { quoteCardRows } from '../../src/ui/views/vendors/quote/quoteCardRows';

/**
 * Direct guards for the extracted quotation-card row computation: "Not stated" wording
 * for optional terms, per-guest and vs-budget cells, the advance cell with its amount,
 * and the deterministic missing/risk lists feeding the alerts.
 */

const plan = makePlan();
const venueId = plan.categories.find((c) => c.key === 'venue')?.id ?? 'unknown';

const quote = (fields: Partial<SavedQuote['fields']>): SavedQuote => ({
  id: 'q-1',
  planId: plan.id,
  categoryId: venueId,
  savedAtISO: '2026-11-01T09:00:00.000Z',
  status: 'review',
  validityDate: null,
  note: '',
  fields: {
    vendorName: 'Sharma Caterers',
    category: 'venue',
    totalPriceMinor: 8_000_000,
    pricePerPlateMinor: null,
    guestMinimum: 100,
    overtimeFeePerHourMinor: null,
    taxIncluded: true,
    advancePercent: 30,
    cancellationPolicy: null,
    inclusions: [],
    exclusions: [],
    ...fields,
  },
});

describe('quotation card rows', () => {
  it('states the total, effective and per-guest amounts for a complete quote', () => {
    const card = quoteCardRows(plan, quote({}));
    const byLabel = Object.fromEntries(card.rows.map((row) => [row.label, row.value]));
    expect(byLabel['Stated total']).toMatch(/^₹?80,000/);
    expect(byLabel[`Effective for ${plan.guestTarget} guests`]).toMatch(/\d/);
    expect(byLabel['Tax included']).toBe('Yes');
    expect(byLabel['Min. guests']).toBe('100');
    expect(card.effective).not.toBeNull();
  });

  it('says "Not stated" for absent terms and cannot compute without any price', () => {
    const card = quoteCardRows(
      plan,
      quote({
        totalPriceMinor: null,
        pricePerPlateMinor: null,
        advancePercent: null,
        taxIncluded: null,
        guestMinimum: null,
      }),
    );
    const byLabel = Object.fromEntries(card.rows.map((row) => [row.label, row.value]));
    expect(byLabel['Stated total']).toBe('Not stated');
    expect(byLabel.Advance).toBe('Not stated');
    expect(byLabel['Tax included']).toBe('Not stated');
    expect(byLabel['Min. guests']).toBe('Not stated');
    expect(byLabel['Cost per guest']).toBe('—');
    expect(byLabel['Vs category budget']).toBe('—');
    expect(card.effective).toBeNull();
  });

  it('shows the advance amount when the effective price is known', () => {
    const card = quoteCardRows(plan, quote({}));
    const byLabel = Object.fromEntries(card.rows.map((row) => [row.label, row.value]));
    expect(byLabel.Advance).toMatch(/^30% \(/);
  });

  it('derives the missing list and the inquiry draft from the same fields', () => {
    const card = quoteCardRows(plan, quote({}));
    expect(card.missing).toContain('per-plate rate');
    expect(card.inquiry.length).toBeGreaterThan(0);
  });
});
