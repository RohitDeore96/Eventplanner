import { z } from 'zod';
import '../schemas/zodRuntime.js';
import { effectiveStorage } from './sessionStore';

/**
 * Per-event personalization preferences (M9), kept beside (not inside) the plan: they are
 * the family's input to the AI features, not plan facts — like quotations. One record per
 * plan id, so events never see each other's preferences (M13.2 isolation). Everything read
 * from storage is re-validated; a bad record degrades to defaults, never to a crash.
 *
 * The default store is resolved through the shared `effectiveStorage()` resolver, so
 * session-only mode (the recovery notice's "continue for this session") routes every read
 * and write to the volatile store: after that choice the real localStorage is never even
 * accessed here, and nothing outlives the tab.
 */

const PREFS_SCHEMA_VERSION = 1;
const STORAGE_KEY = 'utsav.prefs.v1';
const MAX_RECORDS = 48;
const MAX_STORE_BYTES = 60_000;

const FORMALITIES = ['relaxed', 'traditional', 'formal'] as const;
const BUDGET_TIERS = ['value', 'balanced', 'premium'] as const;

type Formality = (typeof FORMALITIES)[number];
type BudgetTier = (typeof BUDGET_TIERS)[number];

export interface EventPreferences {
  readonly vibe: string;
  readonly formality: Formality | '';
  readonly budgetTier: BudgetTier | '';
  readonly mustHaves: string;
  readonly priorities: string;
}

export const EMPTY_PREFERENCES: EventPreferences = {
  vibe: '',
  formality: '',
  budgetTier: '',
  mustHaves: '',
  priorities: '',
};

const prefsRecordSchema = z
  .object({
    planId: z.string().min(1).max(100),
    vibe: z.string().max(200).default(''),
    formality: z.enum([...FORMALITIES, '']).default(''),
    budgetTier: z.enum([...BUDGET_TIERS, '']).default(''),
    mustHaves: z.string().max(300).default(''),
    priorities: z.string().max(300).default(''),
  })
  .strict();

type PrefsRecord = z.infer<typeof prefsRecordSchema>;

const prefsFileSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(PREFS_SCHEMA_VERSION),
    prefs: z.array(prefsRecordSchema).max(MAX_RECORDS),
  })
  .strict();

function loadAll(storage: Storage | undefined): PrefsRecord[] {
  try {
    // Resolved inside the try: the accessor itself can throw (private mode), and in
    // session-only mode this must reach the volatile store, never the real one.
    const raw = effectiveStorage(storage).getItem(STORAGE_KEY);
    if (raw === null || raw.length > MAX_STORE_BYTES) return [];
    const parsed: unknown = JSON.parse(raw);
    const file = prefsFileSchema.safeParse(parsed);
    return file.success ? file.data.prefs : [];
  } catch {
    return [];
  }
}

function writeAll(records: readonly PrefsRecord[], storage: Storage | undefined): boolean {
  try {
    const text = JSON.stringify({ schemaVersion: PREFS_SCHEMA_VERSION, prefs: records });
    if (text.length > MAX_STORE_BYTES) return false;
    effectiveStorage(storage).setItem(STORAGE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function loadPreferences(planId: string, storage?: Storage): EventPreferences {
  const found = loadAll(storage).find((record) => record.planId === planId);
  if (found === undefined) return EMPTY_PREFERENCES;
  const { planId: _planId, ...rest } = found;
  return rest;
}

export function savePreferences(
  planId: string,
  preferences: EventPreferences,
  storage?: Storage,
): boolean {
  const all = loadAll(storage).filter((record) => record.planId !== planId);
  const next = [...all, { planId, ...preferences }].slice(-MAX_RECORDS);
  return writeAll(next, storage);
}

export function deletePreferences(planId: string, storage?: Storage): void {
  try {
    const all = loadAll(storage).filter((record) => record.planId !== planId);
    effectiveStorage(storage).setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: PREFS_SCHEMA_VERSION, prefs: all }),
    );
  } catch {
    /* nothing to clear is fine */
  }
}
