import { fail, ok, type Result } from './result.js';
import type { Plan, RunSheetEntry } from './types.js';
import { checkDate, checkId, checkName, checkNote } from './validate.js';

// The read models (conflicts, order, span) are shared with the run-sheet view; keep the
// established import path stable.
export {
  runSheetConflicts,
  orderedRunSheet,
  runSheetSpan,
  type RunSheetConflict,
} from './runsheetSchedule.js';

/**
 * Event-day run sheet (M7): one ordered list of activities with times, owners and places.
 * Deliberately separate from planning tasks (which carry due dates and dependencies) and
 * from vendor payment due dates — 11.4 requires the three never be confused. All validation
 * lives here so no UI component computes time logic independently.
 */

const MAX_RUNSHEET_ENTRIES = 100;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_TEXT_FIELD = 120;

/** HH:MM 24-hour check; returns the value or a typed failure. */
function checkTime(value: unknown, field: string, label: string): Result<string> {
  return typeof value === 'string' && TIME_PATTERN.test(value)
    ? ok(value)
    : fail('INVALID_TIME', `${label} must be a time as HH:MM (24-hour), for example 09:30.`, field);
}

/** Minutes since midnight; only valid after checkTime. */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function checkShortText(value: unknown, field: string, label: string): Result<string> {
  if (typeof value !== 'string') return fail('INVALID_TEXT', `${label} must be text.`, field);
  const trimmed = value.trim();
  return trimmed.length > MAX_TEXT_FIELD
    ? fail('TEXT_TOO_LONG', `${label} must be ${MAX_TEXT_FIELD} characters or fewer.`, field)
    : ok(trimmed);
}

function checkOwner(plan: Plan, ownerId: string | null): Result<string | null> {
  if (ownerId === null) return ok(null);
  if (typeof ownerId !== 'string' || !plan.vendors.some((v) => v.id === ownerId)) {
    return fail('VENDOR_NOT_FOUND', 'That vendor no longer exists.', 'ownerId');
  }
  return ok(ownerId);
}

interface NewEntry {
  readonly id: string;
  readonly title: string;
  readonly dateISO: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly ownerId: string | null;
  readonly location: string;
  readonly note: string;
}

/** Validates one entry from untrusted input and builds it from named fields only. */
function buildEntry(plan: Plan, input: NewEntry): Result<RunSheetEntry> {
  const id = checkId(input.id, 'id');
  if (!id.ok) return id;
  const title = checkName(input.title, 'title', 'Activity name');
  if (!title.ok) return title;
  const date = checkDate(input.dateISO, 'dateISO');
  if (!date.ok) return date;
  const start = checkTime(input.startTime, 'startTime', 'Start time');
  if (!start.ok) return start;
  const end = checkTime(input.endTime, 'endTime', 'End time');
  if (!end.ok) return end;
  if (minutesOf(end.value) <= minutesOf(start.value)) {
    return fail('TIME_BACKWARDS', 'The end time must be after the start time.', 'endTime');
  }
  const owner = checkOwner(plan, input.ownerId);
  if (!owner.ok) return owner;
  const location = checkShortText(input.location, 'location', 'Location');
  if (!location.ok) return location;
  const note = checkNote(input.note, 'note');
  if (!note.ok) return note;
  return ok({
    id: id.value,
    title: title.value,
    dateISO: date.value,
    startTime: start.value,
    endTime: end.value,
    ownerId: owner.value,
    location: location.value,
    note: note.value,
    done: false,
  });
}

export function addRunSheetEntry(plan: Plan, input: NewEntry): Result<Plan> {
  if (plan.runSheet.length >= MAX_RUNSHEET_ENTRIES) {
    return fail(
      'TOO_MANY_ENTRIES',
      `The run sheet can hold at most ${MAX_RUNSHEET_ENTRIES} activities.`,
      'runSheet',
    );
  }
  if (plan.runSheet.some((e) => e.id === input.id)) {
    return fail('DUPLICATE_ID', 'That activity already exists.', 'id');
  }
  const entry = buildEntry(plan, input);
  if (!entry.ok) return entry;
  return ok({ ...plan, runSheet: [...plan.runSheet, entry.value] });
}

type EntryChanges = Partial<Omit<RunSheetEntry, 'id' | 'done'>>;

/** Applies the free-text-ish fields; the caller handles the date/time and owner rules. */
function applyEntryTextFields(next: RunSheetEntry, changes: EntryChanges): Result<RunSheetEntry> {
  let updated: RunSheetEntry = next;
  if (changes.title !== undefined) {
    const title = checkName(changes.title, 'title', 'Activity name');
    if (!title.ok) return title;
    updated = { ...updated, title: title.value };
  }
  if (changes.location !== undefined) {
    const location = checkShortText(changes.location, 'location', 'Location');
    if (!location.ok) return location;
    updated = { ...updated, location: location.value };
  }
  if (changes.note !== undefined) {
    const note = checkNote(changes.note, 'note');
    if (!note.ok) return note;
    updated = { ...updated, note: note.value };
  }
  return ok(updated);
}

/** Validates the changed fields against the entry's own unchanged values. */
function applyEntryChanges(
  plan: Plan,
  current: RunSheetEntry,
  changes: EntryChanges,
): Result<RunSheetEntry> {
  let next: RunSheetEntry = current;
  const textApplied = applyEntryTextFields(next, changes);
  if (!textApplied.ok) return textApplied;
  next = textApplied.value;
  if (changes.dateISO !== undefined) {
    const date = checkDate(changes.dateISO, 'dateISO');
    if (!date.ok) return date;
    next = { ...next, dateISO: date.value };
  }
  if (changes.startTime !== undefined) {
    const start = checkTime(changes.startTime, 'startTime', 'Start time');
    if (!start.ok) return start;
    next = { ...next, startTime: start.value };
  }
  if (changes.endTime !== undefined) {
    const end = checkTime(changes.endTime, 'endTime', 'End time');
    if (!end.ok) return end;
    next = { ...next, endTime: end.value };
  }
  if (minutesOf(next.endTime) <= minutesOf(next.startTime)) {
    return fail('TIME_BACKWARDS', 'The end time must be after the start time.', 'endTime');
  }
  if (changes.ownerId !== undefined) {
    const owner = checkOwner(plan, changes.ownerId);
    if (!owner.ok) return owner;
    next = { ...next, ownerId: owner.value };
  }
  return ok(next);
}

export function updateRunSheetEntry(plan: Plan, id: string, changes: EntryChanges): Result<Plan> {
  const current = plan.runSheet.find((e) => e.id === id);
  if (!current) return fail('ENTRY_NOT_FOUND', 'That activity no longer exists.', 'id');
  const next = applyEntryChanges(plan, current, changes);
  if (!next.ok) return next;
  return ok({
    ...plan,
    runSheet: plan.runSheet.map((e) => (e.id === id ? next.value : e)),
  });
}

export function toggleRunSheetEntry(plan: Plan, id: string, done: boolean): Result<Plan> {
  if (!plan.runSheet.some((e) => e.id === id)) {
    return fail('ENTRY_NOT_FOUND', 'That activity no longer exists.', 'id');
  }
  return ok({
    ...plan,
    runSheet: plan.runSheet.map((e) => (e.id === id ? { ...e, done } : e)),
  });
}

export function deleteRunSheetEntry(plan: Plan, id: string): Result<Plan> {
  if (!plan.runSheet.some((e) => e.id === id)) {
    return fail('ENTRY_NOT_FOUND', 'That activity no longer exists.', 'id');
  }
  return ok({ ...plan, runSheet: plan.runSheet.filter((e) => e.id !== id) });
}

/** Reorders within the run sheet; the order is display-only (times drive the printed day). */
export function moveRunSheetEntry(plan: Plan, id: string, toIndex: number): Result<Plan> {
  const index = plan.runSheet.findIndex((e) => e.id === id);
  if (index === -1) return fail('ENTRY_NOT_FOUND', 'That activity no longer exists.', 'id');
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= plan.runSheet.length) {
    return fail('INVALID_INDEX', 'That position does not exist.', 'toIndex');
  }
  const next = [...plan.runSheet];
  const [entry] = next.splice(index, 1);
  if (entry === undefined) return fail('ENTRY_NOT_FOUND', 'That activity no longer exists.', 'id');
  next.splice(toIndex, 0, entry);
  return ok({ ...plan, runSheet: next });
}
