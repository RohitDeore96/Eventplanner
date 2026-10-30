import { z } from 'zod';
import '../schemas/zodRuntime.js';
import type { Plan } from '../engine/types';
import { MAX_AMOUNT_MINOR } from '../config/limits';

/**
 * Local-first persistence: the plan lives in the browser. Everything loaded from storage is
 * untrusted, so it is migrated (schemaVersion), validated DEEPLY — every nested record, not
 * just the plan's top level — and checked for domain invariants (referential integrity and
 * dependency-graph sanity) before it may reach the UI. Corrupt data never crashes the app:
 * it is rejected and the app starts fresh.
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
    occasion: z.enum(['wedding', 'birthday', 'community']),
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

/** Referential integrity: no record may point at something that does not exist. */
function referencesHold(plan: Plan): boolean {
  const categoryIds = new Set(plan.categories.map((c) => c.id));
  const vendorIds = new Set(plan.vendors.map((v) => v.id));
  const taskIds = new Set(plan.tasks.map((t) => t.id));
  const instalmentIds = new Set(plan.vendors.flatMap((v) => v.schedule.map((i) => i.id)));
  for (const vendor of plan.vendors) {
    if (!categoryIds.has(vendor.categoryId)) return false;
  }
  for (const expense of plan.expenses) {
    if (!categoryIds.has(expense.categoryId)) return false;
    if (expense.vendorId !== null && !vendorIds.has(expense.vendorId)) return false;
    if (expense.instalmentId !== null && !instalmentIds.has(expense.instalmentId)) return false;
  }
  for (const task of plan.tasks) {
    if (task.dependsOn.some((dep) => !taskIds.has(dep))) return false;
  }
  return !hasDependencyCycle(plan.tasks);
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
