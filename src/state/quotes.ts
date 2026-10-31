import { z } from 'zod';
import '../schemas/zodRuntime.js';
import { quoteFieldsSchema } from '../schemas/ai';

/**
 * Saved vendor quotations, one library per plan, kept beside (not inside) the plan: a quote
 * is an offer from the outside world, not a plan fact — it becomes one only when the family
 * accepts it through the engine (vendor booked at the quoted price). Everything loaded from
 * storage is untrusted and re-validated here.
 *
 * Lifecycle (M7.5): a saved quote starts under review; the family may shortlist or reject
 * it; acceptance requires confirmation and marks the quote so it can never be accepted
 * twice. Drafts exist only as component state before the explicit save.
 */

const QUOTES_SCHEMA_VERSION = 2;
const STORAGE_KEY = 'utsav.quotes.v1';
const MAX_QUOTES = 24;
const MAX_STORE_BYTES = 120_000;

const QUOTE_STATUSES = ['review', 'shortlisted', 'accepted', 'rejected'] as const;
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
    quotes: z.array(savedQuoteSchema).max(MAX_QUOTES),
  })
  .strict();

function loadAllQuotes(storage: Storage): SavedQuote[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null || raw.length > MAX_STORE_BYTES) return [];
    const parsed: unknown = JSON.parse(raw);
    // v1 files parse against the v2 schema: the defaults fill the new fields.
    const file = quotesFileSchema.safeParse(parsed);
    return file.success ? file.data.quotes : [];
  } catch {
    return [];
  }
}

function writeAllQuotes(quotes: readonly SavedQuote[], storage: Storage): boolean {
  try {
    const text = JSON.stringify({ schemaVersion: QUOTES_SCHEMA_VERSION, quotes });
    if (text.length > MAX_STORE_BYTES) return false;
    storage.setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function loadQuotes(planId: string, storage: Storage = window.localStorage): SavedQuote[] {
  return loadAllQuotes(storage).filter((quote) => quote.planId === planId);
}

export function saveQuote(
  quote: Omit<SavedQuote, 'id' | 'savedAtISO' | 'status' | 'validityDate' | 'note'> & {
    validityDate?: string | null;
    note?: string;
  },
  storage: Storage = window.localStorage,
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
  const next = [record, ...all].slice(0, MAX_QUOTES);
  return writeAllQuotes(next, storage) ? record : null;
}

export function setQuoteStatus(
  id: string,
  status: QuoteStatus,
  storage: Storage = window.localStorage,
): boolean {
  const all = loadAllQuotes(storage);
  const next = all.map((quote) => (quote.id === id ? { ...quote, status } : quote));
  return next.some((quote) => quote.id === id && quote.status === status)
    ? writeAllQuotes(next, storage)
    : false;
}

export function updateQuote(
  id: string,
  changes: { validityDate?: string | null; note?: string },
  storage: Storage = window.localStorage,
): boolean {
  const all = loadAllQuotes(storage);
  const next = all.map((quote) =>
    quote.id === id
      ? {
          ...quote,
          validityDate: changes.validityDate ?? quote.validityDate,
          note: changes.note ?? quote.note,
        }
      : quote,
  );
  return writeAllQuotes(next, storage);
}

export function deleteQuote(id: string, storage: Storage = window.localStorage): void {
  try {
    const all = loadAllQuotes(storage);
    const kept = all.filter((quote) => quote.id !== id);
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: QUOTES_SCHEMA_VERSION, quotes: kept }),
    );
  } catch {
    /* a failed removal leaves the library as it was */
  }
}

/** Removes every quotation saved for one event (used when that event is deleted). */
export function deleteQuotesFor(planId: string, storage: Storage = window.localStorage): void {
  try {
    const all = loadAllQuotes(storage);
    const kept = all.filter((quote) => quote.planId !== planId);
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: QUOTES_SCHEMA_VERSION, quotes: kept }),
    );
  } catch {
    /* nothing to clear is fine */
  }
}
