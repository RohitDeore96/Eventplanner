/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';

/**
 * Stage-2 follow-up: the sidecar stores (quotations, per-event preferences) and the
 * language preference used to resolve their default storage as `storage ??
 * window.localStorage`, bypassing the shared resolver. After the recovery notice's
 * "continue for this session" that meant quotes, preferences and the chosen language were
 * still written to the real (blocked) localStorage — contradicting the promise that
 * "changes last only for this session" — and reads touched a store the app knew it could
 * not inspect. These tests pin the fixed contract: in session-only mode EVERY read,
 * write, update and removal of the sidecars and the language goes to the volatile store,
 * the real localStorage is never even accessed, explicit storage arguments still win, and
 * normal (non-session) behaviour is untouched.
 *
 * The session flag is module state by design, so every test here builds a fresh module
 * graph with `vi.resetModules()` + dynamic imports — the same convention as the
 * persistence session-continue tests — and a second fresh graph simulates a reload.
 */

type SessionModule = typeof import('../../src/state/sessionStore');
type QuotesModule = typeof import('../../src/state/quotes');
type PrefsModule = typeof import('../../src/state/prefs');
type I18nModule = typeof import('../../src/lib/i18n');

async function freshModules(): Promise<{
  session: SessionModule;
  quotes: QuotesModule;
  prefs: PrefsModule;
  i18n: I18nModule;
}> {
  vi.resetModules();
  const [session, quotes, prefs, i18n] = await Promise.all([
    import('../../src/state/sessionStore'),
    import('../../src/state/quotes'),
    import('../../src/state/prefs'),
    import('../../src/lib/i18n'),
  ]);
  return { session, quotes, prefs, i18n };
}

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

const preferences = {
  vibe: 'pastel evening',
  formality: 'formal',
  budgetTier: 'balanced',
  mustHaves: 'live sitar',
  priorities: 'Pune, mostly elders',
} as const;

const SIDECAR_KEYS = ['utsav.quotes.v1', 'utsav.prefs.v1', 'utsav.lang.v1'];

/** Every sidecar key is absent from the real store — it must never gain one. */
function expectRealStoreUntouched(): void {
  for (const key of SIDECAR_KEYS) {
    expect(window.localStorage.getItem(key)).toBeNull();
  }
}

describe('sidecars in session-only mode (stage-2 follow-up)', () => {
  it('quotes save, update, and load entirely in session-only mode', async () => {
    const { session, quotes } = await freshModules();
    session.continueSessionWithoutStorage();
    const saved = quotes.saveQuote({ planId: 'ev1', categoryId: 'c1', fields });
    expect(saved).not.toBeNull();
    expect(saved?.status).toBe('review');
    // Status changes and note edits (update operations) reach the session store too.
    expect(quotes.setQuoteStatus(saved?.id ?? '', 'shortlisted')).toBe(true);
    expect(quotes.updateQuote(saved?.id ?? '', { note: 'hold for Diwali' })).toBe(true);
    const loaded = quotes.loadQuotes('ev1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.status).toBe('shortlisted');
    expect(loaded[0]?.note).toBe('hold for Diwali');
    // And the real localStorage gained nothing.
    expectRealStoreUntouched();
  });

  it('event preferences save, delete, and load entirely in session-only mode', async () => {
    const { session, prefs } = await freshModules();
    session.continueSessionWithoutStorage();
    expect(prefs.savePreferences('ev1', { ...preferences })).toBe(true);
    expect(prefs.loadPreferences('ev1').vibe).toBe('pastel evening');
    expect(prefs.loadPreferences('ev1').formality).toBe('formal');
    // The removal reaches the volatile store, not the real one.
    prefs.deletePreferences('ev1');
    expect(prefs.loadPreferences('ev1').vibe).toBe('');
    expectRealStoreUntouched();
  });

  it('language preferences use session storage in session-only mode', async () => {
    const { session, i18n } = await freshModules();
    session.continueSessionWithoutStorage();
    i18n.storeLang('hi');
    expect(i18n.loadLang()).toBe('hi');
    expectRealStoreUntouched();
  });

  it('inaccessible real localStorage is never accessed while session-only', async () => {
    const { session, quotes, prefs, i18n } = await freshModules();
    // A browser whose `window.localStorage` accessor itself throws (private mode):
    // every touch of the real store is recorded and fails loudly.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    let realStoreTouches = 0;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        realStoreTouches += 1;
        throw new Error('SecurityError');
      },
    });
    try {
      session.continueSessionWithoutStorage();
      // Every read, write, update and removal of all three sidecars succeeds WITHOUT a
      // single touch of the real store — the old `(storage ?? window.localStorage)`
      // resolution would have thrown here and silently dropped every save.
      const saved = quotes.saveQuote({ planId: 'ev1', categoryId: 'c1', fields });
      expect(saved).not.toBeNull();
      expect(quotes.setQuoteStatus(saved?.id ?? '', 'shortlisted')).toBe(true);
      expect(quotes.updateQuote(saved?.id ?? '', { note: 'hold' })).toBe(true);
      expect(quotes.loadQuotes('ev1')).toHaveLength(1);
      quotes.deleteQuote(saved?.id ?? '');
      quotes.deleteQuotesFor('ev1');
      expect(prefs.savePreferences('ev1', { ...preferences })).toBe(true);
      expect(prefs.loadPreferences('ev1').vibe).toBe('pastel evening');
      prefs.deletePreferences('ev1');
      i18n.storeLang('hi');
      expect(i18n.loadLang()).toBe('hi');
      expect(realStoreTouches).toBe(0);
    } finally {
      if (descriptor !== undefined) Object.defineProperty(window, 'localStorage', descriptor);
      else delete (window as { localStorage?: unknown }).localStorage;
    }
  });

  it('normal localStorage behaviour remains unchanged outside session-only mode', async () => {
    const { quotes, prefs, i18n } = await freshModules();
    // No continueSessionWithoutStorage(): the default store is the real one, exactly as
    // before this fix.
    const saved = quotes.saveQuote({ planId: 'ev1', categoryId: 'c1', fields });
    expect(saved).not.toBeNull();
    expect(prefs.savePreferences('ev1', { ...preferences })).toBe(true);
    i18n.storeLang('mr');
    expect(window.localStorage.getItem('utsav.quotes.v1')).not.toBeNull();
    expect(window.localStorage.getItem('utsav.prefs.v1')).not.toBeNull();
    expect(window.localStorage.getItem('utsav.lang.v1')).toBe('mr');
    expect(quotes.loadQuotes('ev1')).toHaveLength(1);
    expect(prefs.loadPreferences('ev1').vibe).toBe('pastel evening');
    expect(i18n.loadLang()).toBe('mr');
  });

  it('an explicit storage argument still wins over the session store', async () => {
    const { session, quotes } = await freshModules();
    session.continueSessionWithoutStorage();
    const map = new Map<string, string>();
    const explicit = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    } as unknown as Storage;
    expect(quotes.saveQuote({ planId: 'ev1', categoryId: 'c1', fields }, explicit)).not.toBeNull();
    // The record went to the explicit store and NOT to the volatile session store.
    expect(map.get('utsav.quotes.v1')).not.toBeNull();
    expect(quotes.loadQuotes('ev1')).toHaveLength(0);
    expect(quotes.loadQuotes('ev1', explicit)).toHaveLength(1);
  });

  it('session sidecar data disappears after a simulated reload', async () => {
    const first = await freshModules();
    first.session.continueSessionWithoutStorage();
    expect(first.quotes.saveQuote({ planId: 'ev1', categoryId: 'c1', fields })).not.toBeNull();
    expect(first.prefs.savePreferences('ev1', { ...preferences })).toBe(true);
    first.i18n.storeLang('hi');
    expect(first.quotes.loadQuotes('ev1')).toHaveLength(1);
    expect(first.prefs.loadPreferences('ev1').vibe).toBe('pastel evening');
    expect(first.i18n.loadLang()).toBe('hi');

    // A reload re-evaluates every module: the volatile store and the session flag are
    // gone, and nothing was persisted behind the user's back.
    const second = await freshModules();
    expect(second.session.isSessionOnlyStorage()).toBe(false);
    expect(second.quotes.loadQuotes('ev1')).toHaveLength(0);
    expect(second.prefs.loadPreferences('ev1').vibe).toBe('');
    expect(second.i18n.loadLang()).toBe('en');
    expectRealStoreUntouched();
  });
});
