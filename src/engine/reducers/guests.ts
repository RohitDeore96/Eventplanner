import {
  MAX_GUEST_RECORDS,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PLUS_ONES,
} from '../../config/limits.js';
import { DIETARY_TAGS, RSVPS } from '../enums.js';
import { fail, ok, type Result } from '../result.js';
import type { DietaryTag, Guest, Plan, Rsvp } from '../types.js';
import { checkEnum, checkId, checkName, checkStringList } from '../validate.js';

function checkPlusOnes(value: number): Result<number> {
  return Number.isInteger(value) && value >= 0 && value <= MAX_PLUS_ONES
    ? ok(value)
    : fail(
        'INVALID_PLUS_ONES',
        `Plus-ones must be a whole number from 0 to ${MAX_PLUS_ONES}.`,
        'plusOnes',
      );
}

function checkGroup(value: string): Result<string> {
  if (typeof value !== 'string') return fail('INVALID_TEXT', 'Group must be text.', 'group');
  const trimmed = value.trim();
  return trimmed.length > MAX_NAME_LENGTH
    ? fail('NAME_TOO_LONG', `Group must be ${MAX_NAME_LENGTH} characters or fewer.`, 'group')
    : ok(trimmed);
}

interface NewGuest {
  readonly id: string;
  readonly name: string;
  readonly rsvp: Rsvp;
  readonly plusOnes: number;
  readonly dietary: readonly DietaryTag[];
  readonly group: string;
  readonly contact?: string;
  readonly note?: string;
}

/** Optional free-text fields: trimmed with caps; empty string when absent. The contact cap
 *  MUST match the storage schema (120) or a saved guest would fail its reload validation. */
function checkGuestText(value: unknown, field: string, label: string, max: number): Result<string> {
  if (value === undefined || value === null) return ok('');
  if (typeof value !== 'string') return fail('INVALID_TEXT', `${label} must be text.`, field);
  const trimmed = value.trim();
  return trimmed.length > max
    ? fail('NOTE_TOO_LONG', `${label} must be ${max} characters or fewer.`, field)
    : ok(trimmed);
}

/** Validates RSVP and dietary tags that arrive from untrusted input. */
function checkGuestEnums(
  rsvp: unknown,
  dietary: unknown,
): Result<{ rsvp: Rsvp; dietary: DietaryTag[] }> {
  const checked = checkEnum(rsvp, RSVPS, 'rsvp', 'RSVP');
  if (!checked.ok) return checked;
  const list = checkStringList(dietary, 'dietary', 'Dietary needs', 20);
  if (!list.ok) return list;
  const tags: DietaryTag[] = [];
  for (const tag of list.value) {
    const valid = checkEnum(tag, DIETARY_TAGS, 'dietary', 'Dietary need');
    if (!valid.ok) return valid;
    tags.push(valid.value);
  }
  return ok({ rsvp: checked.value, dietary: tags });
}

export function addGuest(plan: Plan, input: NewGuest): Result<Plan> {
  const id = checkId(input.id, 'id');
  if (!id.ok) return id;
  const name = checkName(input.name, 'name', 'Guest name');
  if (!name.ok) return name;
  const plusOnes = checkPlusOnes(input.plusOnes);
  if (!plusOnes.ok) return plusOnes;
  const group = checkGroup(input.group);
  if (!group.ok) return group;
  const enums = checkGuestEnums(input.rsvp, input.dietary);
  if (!enums.ok) return enums;
  const contact = checkGuestText(input.contact, 'contact', 'Contact details', 120);
  if (!contact.ok) return contact;
  const note = checkGuestText(input.note, 'note', 'Guest notes', MAX_NOTE_LENGTH);
  if (!note.ok) return note;
  if (plan.guests.length >= MAX_GUEST_RECORDS)
    return fail('TOO_MANY_GUESTS', `A plan can list at most ${MAX_GUEST_RECORDS} guests.`);
  if (plan.guests.some((g) => g.id === input.id))
    return fail('DUPLICATE_ID', 'That guest already exists.', 'id');
  // Built from named fields so action keys ("type") or extras never reach storage.
  const guest: Guest = {
    id: input.id,
    name: name.value,
    rsvp: enums.value.rsvp,
    plusOnes: plusOnes.value,
    dietary: enums.value.dietary,
    group: group.value,
    contact: contact.value,
    note: note.value,
  };
  return ok({ ...plan, guests: [...plan.guests, guest] });
}

/** Applies the free-text fields of an update; the caller handles enums and plus-ones. */
function applyGuestText(next: Guest, changes: Partial<Omit<Guest, 'id'>>): Result<Guest> {
  let updated: Guest = next;
  if (changes.name !== undefined) {
    const name = checkName(changes.name, 'name', 'Guest name');
    if (!name.ok) return name;
    updated = { ...updated, name: name.value };
  }
  if (changes.group !== undefined) {
    const group = checkGroup(changes.group);
    if (!group.ok) return group;
    updated = { ...updated, group: group.value };
  }
  if (changes.contact !== undefined) {
    const contact = checkGuestText(changes.contact, 'contact', 'Contact details', 120);
    if (!contact.ok) return contact;
    updated = { ...updated, contact: contact.value };
  }
  if (changes.note !== undefined) {
    const note = checkGuestText(changes.note, 'note', 'Guest notes', MAX_NOTE_LENGTH);
    if (!note.ok) return note;
    updated = { ...updated, note: note.value };
  }
  return ok(updated);
}

export function updateGuest(
  plan: Plan,
  id: string,
  changes: Partial<Omit<Guest, 'id'>>,
): Result<Plan> {
  const current = plan.guests.find((g) => g.id === id);
  if (!current) return fail('GUEST_NOT_FOUND', 'That guest no longer exists.', 'id');
  let next: Guest = current;
  const textApplied = applyGuestText(next, changes);
  if (!textApplied.ok) return textApplied;
  next = textApplied.value;
  if (changes.plusOnes !== undefined) {
    const plusOnes = checkPlusOnes(changes.plusOnes);
    if (!plusOnes.ok) return plusOnes;
    next = { ...next, plusOnes: plusOnes.value };
  }
  if (changes.rsvp !== undefined || changes.dietary !== undefined) {
    const enums = checkGuestEnums(changes.rsvp ?? next.rsvp, changes.dietary ?? next.dietary);
    if (!enums.ok) return enums;
    next = { ...next, rsvp: enums.value.rsvp, dietary: enums.value.dietary };
  }
  return ok({ ...plan, guests: plan.guests.map((g) => (g.id === id ? next : g)) });
}

export function deleteGuest(plan: Plan, id: string): Result<Plan> {
  return plan.guests.some((g) => g.id === id)
    ? ok({ ...plan, guests: plan.guests.filter((g) => g.id !== id) })
    : fail('GUEST_NOT_FOUND', 'That guest no longer exists.', 'id');
}
