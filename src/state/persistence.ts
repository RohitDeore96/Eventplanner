import { z } from 'zod';
import '../schemas/zodRuntime.js';
import type { Plan } from '../engine/types';
import { MAX_AMOUNT_MINOR, MAX_YEAR, MIN_YEAR } from '../config/limits';
import { currencyExponent } from '../engine/money';

/**
 * Local-first persistence: the plan lives in the browser. Everything loaded from storage is
 * untrusted, so it is migrated (schemaVersion), validated DEEPLY — every nested record, not
 * just the plan's top level — and checked for domain invariants (referential integrity,
 * duplicate ids, supported currency, real calendar dates and dependency-graph sanity) before
 * it may reach the UI.
 *
 * Corrupt data never crashes the app and never reaches React state: it is rejected and the
 * caller receives a recovery notice plus the raw stored text, so the family can keep a copy
 * and start fresh. Storage model: ONE active plan under `utsav.plans.v1`. The legacy
 * `utsav.activeId.v1` key from an abandoned multi-plan design is removed on every save and
 * clear so no confusing dead state lingers in browsers.
 */

export const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'utsav.plans.v1';
const LEGACY_ACTIVE_KEY = 'utsav.activeId.v1';
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

/** Why a stored plan could not be loaded. The raw text is kept for an exportable copy. */
type RecoveryReason = 'unreadable' | 'too_large' | 'newer_version' | 'invalid';

export interface RecoveryInfo {
  readonly reason: RecoveryReason;
  /** The untouched stored text, so the family can keep a copy before starting fresh. */
  readonly raw: string;
}

export interface SavedState {
  readonly plan: Plan | null;
  readonly recovery: RecoveryInfo | null;
}

const minor = z.number().int().min(0).max(MAX_AMOUNT_MINOR);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idField = z.string().min(1).max(100);

const categorySchema = z
  .object({
    id: idField,
    key: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    plannedMinor: minor,
  })
  .strict();

const instalmentSchema = z
  .object({
    id: idField,
    kind: z.enum(['advance', 'instalment', 'milestone', 'final', 'balance', 'custom']),
    dueISO: isoDate,
    amountMinor: minor,
  })
  .strict();

const vendorSchema = z
  .object({
    id: idField,
    categoryId: idField,
    name: z.string().min(1).max(120),
    contactNote: z.string().max(500),
    status: z.enum(['not_started', 'contacted', 'quoted', 'booked', 'cancelled']),
    committedMinor: minor.nullable(),
    schedule: z.array(instalmentSchema).max(12),
  })
  .strict();

const expenseSchema = z
  .object({
    id: idField,
    categoryId: idField,
    vendorId: idField.nullable(),
    instalmentId: idField.nullable(),
    dateISO: isoDate,
    amountMinor: minor,
    note: z.string().max(500),
  })
  .strict();

const taskSchema = z
  .object({
    id: idField,
    title: z.string().min(1).max(120),
    dueISO: isoDate,
    dependsOn: z.array(idField).max(10),
    assignee: z.string().max(80).nullable(),
    done: z.boolean(),
  })
  .strict();

const dietary = z.enum([
  'vegetarian',
  'vegan',
  'halal',
  'kosher',
  'gluten_free',
  'dairy_free',
  'nut_allergy',
  'no_onion_garlic',
  'jain',
  'other',
]);

const guestSchema = z
  .object({
    id: idField,
    name: z.string().min(1).max(120),
    rsvp: z.enum(['yes', 'no', 'pending']),
    plusOnes: z.number().int().min(0).max(10),
    dietary: z.array(dietary).max(10),
    group: z.string().max(80),
  })
  .strict();

const deepPlanSchema = z
  .object({
    id: idField,
    name: z.string().min(1).max(120),
    occasion: z.enum(['wedding', 'birthday', 'community', 'milestone']),
    dateISO: isoDate,
    currency: z.string().min(3).max(3),
    locale: z.string().min(2).max(35),
    budgetMinor: minor,
    guestTarget: z.number().int().min(1).max(100_000),
    categories: z.array(categorySchema).max(30),
    vendors: z.array(vendorSchema).max(200),
    expenses: z.array(expenseSchema).max(5_000),
    tasks: z.array(taskSchema).max(500),
    guests: z.array(guestSchema).max(5_000),
  })
  .strict();

/** A stored YYYY-MM-DD string must be a real calendar day inside the engine's year range. */
function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Every id in a list must be unique; duplicates would make lookups ambiguous. */
function hasNoDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

interface PlanIndex {
  readonly categories: ReadonlySet<string>;
  readonly vendors: ReadonlySet<string>;
  readonly tasks: ReadonlySet<string>;
  /** Each vendor's own instalment ids, so an expense's reference can be checked against its owner. */
  readonly instalmentsByVendor: ReadonlyMap<string, ReadonlySet<string>>;
}

function planIndex(plan: Plan): PlanIndex {
  return {
    categories: new Set(plan.categories.map((c) => c.id)),
    vendors: new Set(plan.vendors.map((v) => v.id)),
    tasks: new Set(plan.tasks.map((t) => t.id)),
    instalmentsByVendor: new Map(
      plan.vendors.map((v) => [v.id, new Set(v.schedule.map((i) => i.id))]),
    ),
  };
}

function vendorReferencesHold(plan: Plan, index: PlanIndex): boolean {
  return plan.vendors.every(
    (vendor) =>
      index.categories.has(vendor.categoryId) &&
      vendor.schedule.every((instalment) => isCalendarDate(instalment.dueISO)),
  );
}

function expenseReferencesHold(plan: Plan, index: PlanIndex): boolean {
  for (const expense of plan.expenses) {
    if (!index.categories.has(expense.categoryId)) return false;
    if (!isCalendarDate(expense.dateISO)) return false;
    if (expense.vendorId !== null && !index.vendors.has(expense.vendorId)) return false;
    if (expense.instalmentId !== null) {
      // An instalment reference must belong to the expense's OWN vendor, not just any vendor.
      if (expense.vendorId === null) return false;
      if (!(index.instalmentsByVendor.get(expense.vendorId)?.has(expense.instalmentId) ?? false)) {
        return false;
      }
    }
  }
  return true;
}

function taskReferencesHold(plan: Plan, index: PlanIndex): boolean {
  return plan.tasks.every(
    (task) => isCalendarDate(task.dueISO) && task.dependsOn.every((dep) => index.tasks.has(dep)),
  );
}

/** No id may appear twice anywhere; duplicates would make every lookup ambiguous. */
function idsAreUnique(plan: Plan): boolean {
  const instalmentIds = plan.vendors.flatMap((v) => v.schedule.map((i) => i.id));
  return [
    plan.categories.map((c) => c.id),
    plan.vendors.map((v) => v.id),
    plan.expenses.map((e) => e.id),
    plan.tasks.map((t) => t.id),
    plan.guests.map((g) => g.id),
    instalmentIds,
  ].every(hasNoDuplicates);
}

/**
 * Referential integrity and domain invariants: no record may point at something that does
 * not exist, ids must be unique, the currency must be one the engine understands, every
 * date must be a real calendar day, and a paid instalment must belong to the expense's
 * own vendor.
 */
function referencesHold(plan: Plan): boolean {
  if (currencyExponent(plan.currency) === null) return false;
  if (!isCalendarDate(plan.dateISO)) return false;
  if (!idsAreUnique(plan)) return false;
  const index = planIndex(plan);
  return (
    vendorReferencesHold(plan, index) &&
    expenseReferencesHold(plan, index) &&
    taskReferencesHold(plan, index) &&
    !hasDependencyCycle(plan.tasks)
  );
}

/** Kahn's check: a stored dependency cycle would send the timeline into an impossible order. */
function hasDependencyCycle(tasks: readonly Plan['tasks'][number][]): boolean {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.id, task.dependsOn.length);
    for (const dep of task.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);
    }
  }
  const ready: string[] = tasks.filter((t) => (indegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  let seen = 0;
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    seen += 1;
    for (const dependent of dependents.get(current) ?? []) {
      const left = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, left);
      if (left === 0) ready.push(dependent);
    }
  }
  return seen !== tasks.length;
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
  const parsed = deepPlanSchema.safeParse(data.plan);
  if (!parsed.success) return null;
  const plan = parsed.data as Plan;
  return referencesHold(plan) ? plan : null;
}

const NO_SAVED_STATE: SavedState = { plan: null, recovery: null };

/**
 * Loads the saved plan and, when the stored record cannot be trusted, returns WHY plus the
 * untouched raw text so the UI can offer an exportable copy and a clean restart. Never
 * throws, never hands corrupt data to React state.
 */
export function loadSavedState(storage: Storage = window.localStorage): SavedState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return NO_SAVED_STATE;
    if (raw.length > MAX_STORE_BYTES) {
      return { plan: null, recovery: { reason: 'too_large', raw } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { plan: null, recovery: { reason: 'unreadable', raw } };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { plan: null, recovery: { reason: 'unreadable', raw } };
    }
    const record = parsed as Record<string, unknown>;
    const version = typeof record.schemaVersion === 'number' ? record.schemaVersion : 0;
    const plan = migrate(record);
    if (plan === null) {
      const reason: RecoveryReason = version > SCHEMA_VERSION ? 'newer_version' : 'invalid';
      return { plan: null, recovery: { reason, raw } };
    }
    return { plan, recovery: null };
  } catch {
    return NO_SAVED_STATE; // storage unavailable: start fresh, nothing to recover
  }
}

/** Backwards-compatible shape: just the plan, or null. Recovery details go through loadSavedState. */
export function loadSavedPlan(storage: Storage = window.localStorage): Plan | null {
  return loadSavedState(storage).plan;
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
    // The storage model is one active plan; scrub the legacy multi-plan key if an old
    // version of the app left it behind.
    storage.removeItem(LEGACY_ACTIVE_KEY);
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: 'The browser refused to save (storage full or private mode).' };
  }
}

export function clearSavedPlan(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(LEGACY_ACTIVE_KEY);
  } catch {
    /* nothing to clear is fine */
  }
}
