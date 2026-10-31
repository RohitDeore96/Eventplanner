/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { deletePreferences, loadPreferences, savePreferences } from '../../src/state/prefs';
import {
  deleteQuote,
  deleteQuotesFor,
  loadQuotes,
  saveQuote,
  setQuoteStatus,
} from '../../src/state/quotes';

/**
 * Phase 2 sidecar stores: per-event preferences and the quotation library v2 (status
 * lifecycle, validity, notes). Both must isolate by plan id and migrate old records.
 */

describe('preferences sidecar (M9/M13.2)', () => {
  it('round-trips preferences and keeps events isolated', () => {
    const storage = window.localStorage;
    storage.clear();
    expect(loadPreferences('ev1', storage).vibe).toBe('');
    expect(
      savePreferences(
        'ev1',
        {
          vibe: 'pastel evening',
          formality: 'formal',
          budgetTier: 'balanced',
          mustHaves: 'live sitar',
          priorities: 'Pune, mostly elders',
        },
        storage,
      ),
    ).toBe(true);
    const loaded = loadPreferences('ev1', storage);
    expect(loaded.vibe).toBe('pastel evening');
    expect(loaded.formality).toBe('formal');
    expect(loadPreferences('ev2', storage).vibe).toBe('');
    // Overwriting keeps one record per event.
    expect(savePreferences('ev1', { ...loaded, vibe: 'marigold' }, storage)).toBe(true);
    expect(loadPreferences('ev1', storage).vibe).toBe('marigold');
    deletePreferences('ev1', storage);
    expect(loadPreferences('ev1', storage).vibe).toBe('');
  });

  it('ignores corrupt or oversized records instead of crashing', () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem('utsav.prefs.v1', '{not json');
    expect(loadPreferences('ev1', storage).vibe).toBe('');
    storage.setItem(
      'utsav.prefs.v1',
      JSON.stringify({ schemaVersion: 1, prefs: [{ planId: 'ev1', vibe: 42 }] }),
    );
    expect(loadPreferences('ev1', storage).vibe).toBe('');
  });
});

const fields = {
  vendorName: 'Sharma Caterers',
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

describe('quotation library v2 (M7.1/M7.5)', () => {
  it('saves under review, moves through the lifecycle, and isolates per event', () => {
    const storage = window.localStorage;
    storage.clear();
    const saved = saveQuote({ planId: 'ev1', categoryId: 'c1', fields }, storage);
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe('review');
    expect(loadQuotes('ev2', storage)).toHaveLength(0);
    expect(setQuoteStatus(saved?.id ?? '', 'shortlisted', storage)).toBe(true);
    expect(loadQuotes('ev1', storage)[0]?.status).toBe('shortlisted');
    expect(setQuoteStatus(saved?.id ?? '', 'accepted', storage)).toBe(true);
    expect(loadQuotes('ev1', storage)[0]?.status).toBe('accepted');
    // An unknown id is a no-op that reports failure, not a silent success.
    expect(setQuoteStatus('nope', 'accepted', storage)).toBe(false);
  });

  it('saves validity date and note, and removes by event', () => {
    const storage = window.localStorage;
    storage.clear();
    const a = saveQuote(
      { planId: 'ev1', categoryId: 'c1', fields, validityDate: '2026-12-31', note: 'hold' },
      storage,
    );
    saveQuote({ planId: 'ev2', categoryId: 'c1', fields }, storage);
    const stored = loadQuotes('ev1', storage)[0];
    expect(stored?.validityDate).toBe('2026-12-31');
    expect(stored?.note).toBe('hold');
    deleteQuotesFor('ev1', storage);
    expect(loadQuotes('ev1', storage)).toHaveLength(0);
    expect(loadQuotes('ev2', storage)).toHaveLength(1);
    deleteQuote(a?.id ?? '', storage);
    expect(loadQuotes('ev2', storage)).toHaveLength(1);
  });

  it('migrates a v1 library (no status fields) into the v2 defaults', () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 1,
        quotes: [
          {
            id: 'q-old',
            planId: 'ev1',
            categoryId: 'c1',
            savedAtISO: '2026-10-30T00:00:00.000Z',
            fields,
          },
        ],
      }),
    );
    const migrated = loadQuotes('ev1', storage);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]?.status).toBe('review');
    expect(migrated[0]?.validityDate).toBeNull();
    expect(migrated[0]?.note).toBe('');
    expect(setQuoteStatus('q-old', 'accepted', storage)).toBe(true);
  });
});
