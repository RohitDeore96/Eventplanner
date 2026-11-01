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
 *
 * The six load outcomes are distinct: EMPTY storage (no key — a normal fresh start),
 * INACCESSIBLE storage (`unavailable` recovery — private mode or blocked storage; never
 * disguised as an empty workspace), MALFORMED JSON and non-object JSON (`unreadable`,
 * raw kept for export), UNSUPPORTED data (`unreadable` for non-records, `droppedInvalid`
 * for records that fail their gates), OVERSIZED data (`too_large`) and FAILED MIGRATIONS
 * (`newer_version`). Every storage access runs inside the try, so a browser that throws
 * on `window.localStorage` itself surfaces the recovery path instead of crashing the app.
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

/**
 * Why the stored workspace could not be loaded at all. The raw text is kept for an
 * exportable copy — except for `unavailable`, where storage refused to give anything.
 */
type RecoveryReason = 'unavailable' | 'unreadable' | 'too_large' | 'newer_version';

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

/** A workspace that could not be loaded, with the reason and the raw text (if any) for export. */
function unusable(reason: RecoveryReason, raw: string): Workspace {
  return { ...EMPTY_WORKSPACE, recovery: { reason, raw } };
}

/**
 * Loads the whole workspace (every saved event plus which one is active). A record that
 * cannot be read at all returns WHY plus the untouched raw text; an event that fails its
 * own checks is dropped individually — the rest survive and the count is reported.
 * Storage that cannot even be read reports `unavailable` — it is NEVER reported as an
 * empty workspace, because the family's saved events may still be in there.
 */
export function loadWorkspace(storage?: Storage): Workspace {
  try {
    // Resolved here, inside the try: `window.localStorage` itself can throw (private
    // mode, sandboxed frame, storage disabled), and that must surface as recovery,
    // not as an exception escaping the loader and crashing the app on mount.
    const raw = (storage ?? window.localStorage).getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_WORKSPACE;
    if (byteLength(raw) > MAX_STORE_BYTES) return unusable('too_large', raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return unusable('unreadable', raw);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      // A bare number, string, boolean, list or `null` is not a workspace record —
      // unsupported data is reported, never silently loaded as an empty workspace.
      return unusable('unreadable', raw);
    }
    const record = parsed as Record<string, unknown>;
    const version = typeof record.schemaVersion === 'number' ? record.schemaVersion : 0;
    if (version > SCHEMA_VERSION) return unusable('newer_version', raw);
    return migrate(record);
  } catch {
    return unusable('unavailable', ''); // storage refused to be read; nothing to export
  }
}

/**
 * Writes the workspace with the active event's id and the archive list; stays under the
 * byte cap. The default storage is resolved inside the try, so a browser that throws on
 * `window.localStorage` reports an honest refusal instead of crashing the caller.
 */
export function saveWorkspace(
  plans: readonly Plan[],
  activeId: string | null,
  archivedIds: readonly string[] = [],
  storage?: Storage,
): StorageStatus {
  try {
    const store = storage ?? window.localStorage;
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
    store.setItem(STORAGE_KEY, text);
    // The legacy single-plan active marker is dead state; scrub it wherever we write.
    store.removeItem(LEGACY_ACTIVE_KEY);
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
  storage?: Storage,
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
export function loadSavedState(storage?: Storage): SavedState {
  const workspace = loadWorkspace(storage);
  if (workspace.recovery !== null) return { plan: null, recovery: workspace.recovery };
  return {
    plan: workspace.plans.find((p) => p.id === workspace.activeId) ?? null,
    recovery: null,
  };
}

/** Backwards-compatible shape: just the plan, or null. */
export function loadSavedPlan(storage?: Storage): Plan | null {
  return loadSavedState(storage).plan;
}

export function clearSavedPlan(storage?: Storage): void {
  try {
    const store = storage ?? window.localStorage;
    store.removeItem(STORAGE_KEY);
    store.removeItem(LEGACY_ACTIVE_KEY);
  } catch {
    /* nothing to clear is fine */
  }
}
