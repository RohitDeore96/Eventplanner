import { z } from 'zod';
import '../schemas/zodRuntime.js';
import type { Plan } from '../engine/types';
import { MAX_AMOUNT_MINOR, MAX_EVENTS, MAX_YEAR, MIN_YEAR } from '../config/limits';
import { currencyExponent } from '../engine/money';

/**
 * Local-first persistence: plans live in the browser. Everything loaded from storage is
 * untrusted, so it is migrated (schemaVersion), validated DEEPLY — every nested record of
 * every event, not just the top level — and checked for domain invariants (referential
 * integrity, duplicate ids, supported currency, real calendar dates and dependency-graph
 * sanity) before it may reach the UI.
 *
 * Storage model (schemaVersion 2, R8 multi-event): ONE workspace record under
 * `utsav.plans.v1` holding up to MAX_EVENTS plans plus the active event's id. Version 1
 * (a single `plan`) and version 0 (no marker) migrate forward: the lone plan becomes the
 * active event of a fresh workspace. A saved event that fails validation is dropped on its
 * own — the rest of the workspace survives, and the count is reported so the UI can say so.
 * Corrupt data never crashes the app and never reaches React state.
 */

export const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'utsav.plans.v1';
const LEGACY_ACTIVE_KEY = 'utsav.activeId.v1';
const MAX_STORE_BYTES = 400_000;

interface WorkspaceRecord {
  readonly schemaVersion: number;
  readonly savedAtISO: string;
  readonly activeId: string | null;
  readonly plans: readonly Plan[];
}

export interface StorageStatus {
  readonly ok: boolean;
  /** Human-readable reason when saving was skipped (quota, private mode, size). */
  readonly reason: string | null;
}

/** Why the stored workspace could not be loaded at all. The raw text is kept for an exportable copy. */
type RecoveryReason = 'unreadable' | 'too_large' | 'newer_version';

export interface RecoveryInfo {
  readonly reason: RecoveryReason;
  /** The untouched stored text, so the family can keep a copy before starting fresh. */
  readonly raw: string;
}

export interface Workspace {
  readonly plans: readonly Plan[];
  readonly activeId: string | null;
  /** How many saved events failed validation and were left out (never silently). */
  readonly droppedInvalid: number;
  readonly recovery: RecoveryInfo | null;
}

/** Backwards-compatible shape: just the active plan, or null. */
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

/** Deep-validates one plan; null when the record cannot be trusted. */
function validatePlan(raw: unknown): Plan | null {
  const parsed = deepPlanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const plan = parsed.data as Plan;
  return referencesHold(plan) ? plan : null;
}

/** Migrations run oldest -> newest, ending at the v2 workspace shape. */
function migrate(raw: Record<string, unknown>): Workspace {
  // v2 keeps an array; v1 kept one `plan`; v0 (no marker) had the same single-plan shape.
  const candidates: readonly unknown[] = Array.isArray(raw.plans)
    ? (raw.plans as readonly unknown[])
    : raw.plan !== undefined
      ? [raw.plan]
      : [];
  let dropped = 0;
  const plans: Plan[] = [];
  const seenIds = new Set<string>();
  for (const candidate of candidates) {
    if (plans.length >= MAX_EVENTS) {
      dropped += 1;
      continue;
    }
    const plan = validatePlan(candidate);
    if (plan === null || seenIds.has(plan.id)) {
      dropped += 1;
      continue;
    }
    seenIds.add(plan.id);
    plans.push(plan);
  }
  const storedActive = typeof raw.activeId === 'string' ? raw.activeId : null;
  const activeId =
    storedActive !== null && seenIds.has(storedActive) ? storedActive : (plans[0]?.id ?? null);
  return { plans, activeId, droppedInvalid: dropped, recovery: null };
}

const EMPTY_WORKSPACE: Workspace = { plans: [], activeId: null, droppedInvalid: 0, recovery: null };

/**
 * Loads the whole workspace (every saved event plus which one is active). A record that
 * cannot be read at all returns WHY plus the untouched raw text; an event that fails its
 * own checks is dropped individually — the rest survive and the count is reported.
 */
export function loadWorkspace(storage: Storage = window.localStorage): Workspace {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_WORKSPACE;
    if (raw.length > MAX_STORE_BYTES) {
      return { ...EMPTY_WORKSPACE, recovery: { reason: 'too_large', raw } };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...EMPTY_WORKSPACE, recovery: { reason: 'unreadable', raw } };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...EMPTY_WORKSPACE, recovery: { reason: 'unreadable', raw } };
    }
    const record = parsed as Record<string, unknown>;
    const version = typeof record.schemaVersion === 'number' ? record.schemaVersion : 0;
    if (version > SCHEMA_VERSION) {
      return { ...EMPTY_WORKSPACE, recovery: { reason: 'newer_version', raw } };
    }
    return migrate(record);
  } catch {
    return EMPTY_WORKSPACE; // storage unavailable: start fresh, nothing to recover
  }
}

/** Writes the workspace with the active event's id; the record stays under the byte cap. */
export function saveWorkspace(
  plans: readonly Plan[],
  activeId: string | null,
  storage: Storage = window.localStorage,
): StorageStatus {
  try {
    if (plans.length > MAX_EVENTS) {
      return { ok: false, reason: `Utsav keeps up to ${MAX_EVENTS} events in one browser.` };
    }
    const payload: WorkspaceRecord = {
      schemaVersion: SCHEMA_VERSION,
      savedAtISO: new Date().toISOString(),
      activeId,
      plans: [...plans],
    };
    const text = JSON.stringify(payload);
    if (text.length > MAX_STORE_BYTES) {
      return { ok: false, reason: 'These events are too large to autosave in the browser.' };
    }
    storage.setItem(STORAGE_KEY, text);
    // The legacy single-plan active marker is dead state; scrub it wherever we write.
    storage.removeItem(LEGACY_ACTIVE_KEY);
    return { ok: true, reason: null };
  } catch {
    return { ok: false, reason: 'The browser refused to save (storage full or private mode).' };
  }
}

/**
 * Backwards-compatible save: upserts ONE plan and makes it the active event. It is only
 * ever called for the active plan (edit) or a brand-new one (create, demo), so the saved
 * plan is always what the app opens with.
 */
export function savePlan(plan: Plan, storage: Storage = window.localStorage): StorageStatus {
  const current = loadWorkspace(storage);
  const plans = current.plans.some((p) => p.id === plan.id)
    ? current.plans.map((p) => (p.id === plan.id ? plan : p))
    : [...current.plans, plan];
  return saveWorkspace(plans, plan.id, storage);
}

/** Backwards-compatible read: just the active plan (or null), recovery details included. */
export function loadSavedState(storage: Storage = window.localStorage): SavedState {
  const workspace = loadWorkspace(storage);
  if (workspace.recovery !== null) return { plan: null, recovery: workspace.recovery };
  return {
    plan: workspace.plans.find((p) => p.id === workspace.activeId) ?? null,
    recovery: null,
  };
}

/** Backwards-compatible shape: just the plan, or null. */
export function loadSavedPlan(storage: Storage = window.localStorage): Plan | null {
  return loadSavedState(storage).plan;
}

export function clearSavedPlan(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(LEGACY_ACTIVE_KEY);
  } catch {
    /* nothing to clear is fine */
  }
}
