import { z } from 'zod';
import '../schemas/zodRuntime.js';
import { quoteFieldsSchema } from '../schemas/ai';
import { effectiveStorage } from './sessionStore';

/**
 * Saved vendor quotations, one library per plan, kept beside (not inside) the plan: a quote
 * is an offer from the outside world, not a plan fact — it becomes one only when the family
 * accepts it through the engine (vendor booked at the quoted price). Everything loaded from
 * storage is untrusted and re-validated here.
 *
 * Lifecycle (M7.5): a saved quote starts under review; the family may shortlist or reject
 * it; acceptance requires confirmation and marks the quote so it can never be accepted
 * twice. Drafts exist only as component state before the explicit save.
 *
 * The default store is resolved through the shared `effectiveStorage()` resolver, so
 * session-only mode (the recovery notice's "continue for this session") routes every read,
 * write and removal to the volatile store: after that choice the real localStorage is
 * never even accessed here, and no quotation outlives the tab.
 */

const QUOTES_SCHEMA_VERSION = 2;
const STORAGE_KEY = 'utsav.quotes.v1';
/** Product cap: saving is refused (never a silent drop) once the library holds this many. */
const MAX_QUOTES = 24;
/** Parse-level bound only: a foreign or older writer may have stored more, and rejecting
 * the whole file at load would destroy every record. The product cap is enforced at save. */
const MAX_PARSED_QUOTES = 200;
const MAX_STORE_BYTES = 120_000;

/** Real UTF-8 size of a string: `length` counts UTF-16 units, so Devanagari or emoji text
 * would slip past a unit-based cap by up to 3× (same standard as the workspace store). */
const utf8 = new TextEncoder();
function byteLength(text: string): number {
  return utf8.encode(text).length;
}

/** Runtime status set: the state module's own closed enum, shared with the quote UI. */
export const QUOTE_STATUSES = ['review', 'shortlisted', 'accepted', 'rejected'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const savedQuoteSchema = z
  .object({
    id: z.string().min(1).max(100),
    planId: z.string().min(1).max(100),
    categoryId: z.string().min(1).max(100),
    savedAtISO: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
    fields: quoteFieldsSchema,
    // v2 fields: v1 records migrate with these defaults (under review, no validity, no note).
    status: z.enum(QUOTE_STATUSES).default('review'),
    validityDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    note: z.string().max(500).default(''),
  })
  .strict();

export type SavedQuote = z.infer<typeof savedQuoteSchema>;

const quotesFileSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(QUOTES_SCHEMA_VERSION),
    quotes: z.array(savedQuoteSchema).max(MAX_PARSED_QUOTES),
  })
  .strict();

/*
 * Sidecar write notification: the compare section re-reads the library when any write
 * happens, including writes from outside this view (the header's Undo/Redo reverting or
 * re-applying an accepted quotation). Subscribers are UI-only; no data is passed.
 */
const listeners = new Set<() => void>();

export function onQuotesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function loadAllQuotes(storage: Storage | undefined): SavedQuote[] {
  try {
    // Resolved inside the try: the accessor itself can throw (private mode), and in
    // session-only mode this must reach the volatile store, never the real one.
    const raw = effectiveStorage(storage).getItem(STORAGE_KEY);
    if (raw === null || byteLength(raw) > MAX_STORE_BYTES) return [];
    const parsed: unknown = JSON.parse(raw);
    // v1 files parse against the v2 schema: the defaults fill the new fields.
    const file = quotesFileSchema.safeParse(parsed);
    return file.success ? file.data.quotes : [];
  } catch {
    return [];
  }
}

function writeAllQuotes(quotes: readonly SavedQuote[], storage: Storage | undefined): boolean {
  try {
    const text = JSON.stringify({ schemaVersion: QUOTES_SCHEMA_VERSION, quotes });
    if (byteLength(text) > MAX_STORE_BYTES) return false;
    effectiveStorage(storage).setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function loadQuotes(planId: string, storage?: Storage): SavedQuote[] {
  return loadAllQuotes(storage).filter((quote) => quote.planId === planId);
}

export function saveQuote(
  quote: Omit<SavedQuote, 'id' | 'savedAtISO' | 'status' | 'validityDate' | 'note'> & {
    validityDate?: string | null;
    note?: string;
  },
  storage?: Storage,
): SavedQuote | null {
  // Read the WHOLE library (every plan), not just this plan's quotes, or saving for one
  // plan would silently drop another plan's quotations.
  const all = loadAllQuotes(storage);
  const record: SavedQuote = {
    ...quote,
    validityDate: quote.validityDate ?? null,
    note: quote.note ?? '',
    status: 'review',
    id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    savedAtISO: new Date().toISOString(),
  };
  // The library is full: refuse honestly instead of silently discarding the oldest
  // quotation (a silent drop looked like a successful save and lost user data).
  if (all.length >= MAX_QUOTES) return null;
  const next = [record, ...all];
  const written = writeAllQuotes(next, storage);
  if (written) notify();
  return written ? record : null;
}

export function setQuoteStatus(id: string, status: QuoteStatus, storage?: Storage): boolean {
  const all = loadAllQuotes(storage);
  const next = all.map((quote) => (quote.id === id ? { ...quote, status } : quote));
  const changed = next.some((quote) => quote.id === id && quote.status === status);
  if (changed && writeAllQuotes(next, storage)) {
    notify();
    return true;
  }
  return false;
}

export function updateQuote(
  id: string,
  changes: { validityDate?: string | null; note?: string },
  storage?: Storage,
): boolean {
  const all = loadAllQuotes(storage);
  if (!all.some((quote) => quote.id === id)) return false; // unknown id: report, don't no-op
  const next = all.map((quote) =>
    quote.id === id
      ? {
          ...quote,
          validityDate: changes.validityDate ?? quote.validityDate,
          note: changes.note ?? quote.note,
        }
      : quote,
  );
  const written = writeAllQuotes(next, storage);
  if (written) notify();
  return written;
}

export function deleteQuote(id: string, storage?: Storage): void {
  try {
    const all = loadAllQuotes(storage);
    const kept = all.filter((quote) => quote.id !== id);
    effectiveStorage(storage).setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: QUOTES_SCHEMA_VERSION, quotes: kept }),
    );
    notify();
  } catch {
    /* a failed removal leaves the library as it was */
  }
}

/** Removes every quotation saved for one event (used when that event is deleted). */
export function deleteQuotesFor(planId: string, storage?: Storage): void {
  try {
    const all = loadAllQuotes(storage);
    const kept = all.filter((quote) => quote.planId !== planId);
    effectiveStorage(storage).setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: QUOTES_SCHEMA_VERSION, quotes: kept }),
    );
    notify();
  } catch {
    /* nothing to clear is fine */
  }
}
