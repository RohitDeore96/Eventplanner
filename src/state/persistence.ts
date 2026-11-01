import type { Plan } from '../engine/types';
import { MAX_EVENTS } from '../config/limits';
import { validatePlan } from './persistenceInvariants';

/**
 * Local-first persistence: plans live in the browser. Everything loaded from storage is
 * untrusted, so it is migrated (schemaVersion), validated DEEPLY — every nested record of
 * every event, not just the top level — and checked for domain invariants (referential
 * integrity, duplicate ids, supported currency, real calendar dates and dependency-graph
 * sanity) before it may reach the UI. The validation gates live in
 * `persistenceSchemas.ts` (shape and bounds) and `persistenceInvariants.ts` (content).
 *
 * Storage model (schemaVersion 3, R8 multi-event + Phase 2 archive): ONE workspace record
 * under `utsav.plans.v1` holding up to MAX_EVENTS plans, the active event's id and the
 * archived event ids. Versions 1 (a single `plan`), 0 (no marker) and 2 (no archive list)
 * migrate forward: a lone plan becomes the active event of a fresh workspace; absent
 * archives become an empty list. A saved event that fails validation is dropped on its
 * own — the rest of the workspace survives, and the count is reported so the UI can say so.
 * Corrupt data never crashes the app and never reaches React state.
 */

export const SCHEMA_VERSION = 3;
const STORAGE_KEY = 'utsav.plans.v1';
const LEGACY_ACTIVE_KEY = 'utsav.activeId.v1';
const MAX_STORE_BYTES = 400_000;

interface WorkspaceRecord {
  readonly schemaVersion: number;
  readonly savedAtISO: string;
  readonly activeId: string | null;
  readonly archivedIds: readonly string[];
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
  /** Events set aside (archived) but never deleted; restore brings them back. */
  readonly archivedIds: readonly string[];
  /** How many saved events failed validation and were left out (never silently). */
  readonly droppedInvalid: number;
  readonly recovery: RecoveryInfo | null;
}

/** Backwards-compatible shape: just the active plan, or null. */
export interface SavedState {
  readonly plan: Plan | null;
  readonly recovery: RecoveryInfo | null;
}

/** Real UTF-8 size of a string. `length` counts UTF-16 units, so multibyte content
 * (Devanagari, emoji) would slip past a unit-based cap by up to 3× — the same standard
 * the API layer applies with Buffer.byteLength for request bodies. */
const utf8 = new TextEncoder();
function byteLength(text: string): number {
  return utf8.encode(text).length;
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
  // Archive list (v3): only ids that actually exist may stay in it.
  const archivedIds = Array.isArray(raw.archivedIds)
    ? [...new Set(raw.archivedIds.filter((id) => typeof id === 'string' && seenIds.has(id)))]
    : [];
  return { plans, activeId, archivedIds, droppedInvalid: dropped, recovery: null };
}

const EMPTY_WORKSPACE: Workspace = {
  plans: [],
  activeId: null,
  archivedIds: [],
  droppedInvalid: 0,
  recovery: null,
};

/**
 * Loads the whole workspace (every saved event plus which one is active). A record that
 * cannot be read at all returns WHY plus the untouched raw text; an event that fails its
 * own checks is dropped individually — the rest survive and the count is reported.
 */
export function loadWorkspace(storage: Storage = window.localStorage): Workspace {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_WORKSPACE;
    if (byteLength(raw) > MAX_STORE_BYTES) {
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

/** Writes the workspace with the active event's id and the archive list; stays under the byte cap. */
export function saveWorkspace(
  plans: readonly Plan[],
  activeId: string | null,
  archivedIds: readonly string[] = [],
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
      archivedIds: [...archivedIds],
      plans: [...plans],
    };
    const text = JSON.stringify(payload);
    if (byteLength(text) > MAX_STORE_BYTES) {
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
export function savePlan(
  plan: Plan,
  storage: Storage = window.localStorage,
  archivedIds: readonly string[] = [],
): StorageStatus {
  const current = loadWorkspace(storage);
  const plans = current.plans.some((p) => p.id === plan.id)
    ? current.plans.map((p) => (p.id === plan.id ? plan : p))
    : [...current.plans, plan];
  const archives = current.archivedIds.length > 0 ? current.archivedIds : archivedIds;
  return saveWorkspace(plans, plan.id, archives, storage);
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
