import { z } from 'zod';
import '../schemas/zodRuntime.js';
import { quoteFieldsSchema } from '../schemas/ai';

/**
 * Saved vendor quotations, one library per plan, kept beside (not inside) the plan: a quote
 * is an offer from the outside world, not a plan fact — it becomes one only when the family
 * accepts it through the engine (vendor booked at the quoted price). Everything loaded from
 * storage is untrusted and re-validated here.
 */

const QUOTES_SCHEMA_VERSION = 1;
const STORAGE_KEY = 'utsav.quotes.v1';
const MAX_QUOTES = 24;
const MAX_STORE_BYTES = 120_000;

const savedQuoteSchema = z
  .object({
    id: z.string().min(1).max(100),
    planId: z.string().min(1).max(100),
    categoryId: z.string().min(1).max(100),
    savedAtISO: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
    fields: quoteFieldsSchema,
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
    const file = quotesFileSchema.safeParse(parsed);
    return file.success ? file.data.quotes : [];
  } catch {
    return [];
  }
}

export function loadQuotes(planId: string, storage: Storage = window.localStorage): SavedQuote[] {
  return loadAllQuotes(storage).filter((quote) => quote.planId === planId);
}

export function saveQuote(
  quote: Omit<SavedQuote, 'id' | 'savedAtISO'>,
  storage: Storage = window.localStorage,
): SavedQuote | null {
  try {
    // Read the WHOLE library (every plan), not just this plan's quotes, or saving for one
    // plan would silently drop another plan's quotations.
    const all = loadAllQuotes(storage);
    const record: SavedQuote = {
      ...quote,
      id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      savedAtISO: new Date().toISOString(),
    };
    const next = [record, ...all].slice(0, MAX_QUOTES);
    const payload = { schemaVersion: QUOTES_SCHEMA_VERSION, quotes: next };
    const text = JSON.stringify(payload);
    if (text.length > MAX_STORE_BYTES) return null;
    storage.setItem(STORAGE_KEY, text);
    return record;
  } catch {
    return null;
  }
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
