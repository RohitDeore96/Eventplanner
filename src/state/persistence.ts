import { z } from 'zod';
import '../schemas/zodRuntime.js';
import type { Plan } from '../engine/types';

/**
 * Local-first persistence: the plan lives in the browser. Everything loaded from storage is
 * untrusted, so it is migrated (schemaVersion) and then re-validated by the caller through
 * the engine — nothing reaches the UI without passing validation.
 */

export const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'utsav.plans.v1';
const ACTIVE_KEY = 'utsav.activeId.v1';
const MAX_STORE_BYTES = 400_000;

interface StoredPlan {
  readonly schemaVersion: number;
  readonly savedAtISO: string;
  readonly plan: Plan;
}

export interface StorageStatus {
  readonly ok: boolean;
  /** Human-readable reason when saving was skipped (quota, private mode, size). */
  readonly reason: string | null;
}

/** Migrations run oldest -> newest. Each step takes the previous version's shape. */
function migrate(raw: Record<string, unknown>): Plan | null {
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) return null; // newer than this build: never guess
  let data = { ...raw };
  // version 0 -> 1: add schemaVersion and savedAtISO (first release wrote neither).
  if (version < 1) {
    data = { ...data, schemaVersion: 1, savedAtISO: new Date().toISOString() };
  }
  return isPlanShape(data.plan) ? (data.plan as Plan) : null;
}

/**
 * Structural pre-check before the engine re-validates the real invariants. Storage is
 * untrusted input, so the shape is checked with a schema, not trust.
 */
const planShape = z.object({
  id: z.string(),
  name: z.string(),
  occasion: z.string(),
  dateISO: z.string(),
  currency: z.string(),
  locale: z.string(),
  budgetMinor: z.number(),
  guestTarget: z.number(),
  categories: z.array(z.unknown()),
  vendors: z.array(z.unknown()),
  expenses: z.array(z.unknown()),
  tasks: z.array(z.unknown()),
  guests: z.array(z.unknown()),
});

function isPlanShape(value: unknown): boolean {
  return planShape.safeParse(value).success;
}

export function loadSavedPlan(storage: Storage = window.localStorage): Plan | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    if (raw.length > MAX_STORE_BYTES) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return migrate(parsed as Record<string, unknown>);
  } catch {
    return null; // corrupted or unavailable storage: start fresh, never crash
  }
}

export function savePlan(plan: Plan, storage: Storage = window.localStorage): StorageStatus {
  try {
    const payload: StoredPlan = {
      schemaVersion: SCHEMA_VERSION,
      savedAtISO: new Date().toISOString(),
      plan,
    };
    const text = JSON.stringify(payload);
    if (text.length > MAX_STORE_BYTES) {
      return { ok: false, reason: 'This plan is too large to autosave in the browser.' };
    }
    storage.setItem(STORAGE_KEY, text);
    storage.setItem(ACTIVE_KEY, plan.id);
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: 'The browser refused to save (storage full or private mode).' };
  }
}

export function clearSavedPlan(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(ACTIVE_KEY);
  } catch {
    /* nothing to clear is fine */
  }
}
