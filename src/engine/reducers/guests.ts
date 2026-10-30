import { MAX_GUEST_RECORDS, MAX_NAME_LENGTH, MAX_PLUS_ONES } from '../../config/limits';
import { DIETARY_TAGS, RSVPS } from '../enums';
import { fail, ok, type Result } from '../result';
import type { DietaryTag, Guest, Plan, Rsvp } from '../types';
import { checkEnum, checkId, checkName, checkStringList } from '../validate';

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
  };
  return ok({ ...plan, guests: [...plan.guests, guest] });
}

export function updateGuest(
  plan: Plan,
  id: string,
  changes: Partial<Omit<Guest, 'id'>>,
): Result<Plan> {
  const current = plan.guests.find((g) => g.id === id);
  if (!current) return fail('GUEST_NOT_FOUND', 'That guest no longer exists.', 'id');
  let next: Guest = current;
  if (changes.name !== undefined) {
    const name = checkName(changes.name, 'name', 'Guest name');
    if (!name.ok) return name;
    next = { ...next, name: name.value };
  }
  if (changes.plusOnes !== undefined) {
    const plusOnes = checkPlusOnes(changes.plusOnes);
    if (!plusOnes.ok) return plusOnes;
    next = { ...next, plusOnes: plusOnes.value };
  }
  if (changes.group !== undefined) {
    const group = checkGroup(changes.group);
    if (!group.ok) return group;
    next = { ...next, group: group.value };
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
