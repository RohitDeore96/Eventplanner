import { MAX_INSTALMENTS_PER_VENDOR, MAX_VENDORS } from '../../config/limits.js';
import { PAYMENT_KINDS } from '../enums.js';
import { fail, ok, type Result } from '../result.js';
import type { InstalmentInput } from '../actions.js';
import type { BookingStatus, Instalment, Plan, Vendor } from '../types.js';
import { checkAmount, checkDate, checkEnum, checkId, checkName, checkNote } from '../validate.js';
import {
  checkBooking,
  checkContactField,
  checkEmail,
  checkPhone,
  checkStatusInput,
  sameName,
  type NewVendor,
} from './vendorValidate.js';

function firstFailure(results: readonly Result<unknown>[]): Result<never> | undefined {
  for (const result of results) if (!result.ok) return result;
  return undefined;
}

export function addVendor(plan: Plan, input: NewVendor): Result<Plan> {
  const id = checkId(input.id, 'id');
  if (!id.ok) return id;
  const name = checkName(input.name, 'name', 'Vendor name');
  if (!name.ok) return name;
  const note = checkNote(input.contactNote, 'contactNote');
  if (!note.ok) return note;
  if (!plan.categories.some((c) => c.id === input.categoryId))
    return fail('CATEGORY_NOT_FOUND', 'Choose an existing category.', 'categoryId');
  if (plan.vendors.length >= MAX_VENDORS)
    return fail('TOO_MANY_VENDORS', `A plan can have at most ${MAX_VENDORS} vendors.`);
  if (plan.vendors.some((v) => v.id === input.id))
    return fail('DUPLICATE_ID', 'That vendor already exists.', 'id');
  if (plan.vendors.some((v) => v.categoryId === input.categoryId && sameName(v.name, name.value))) {
    return fail(
      'DUPLICATE_VENDOR',
      'You already have a vendor with that name in this category.',
      'name',
    );
  }
  const statusInput = checkStatusInput(input.status, input.committedMinor);
  if (!statusInput.ok) return statusInput;
  const booking = checkBooking(statusInput.value.status, statusInput.value.committedMinor);
  if (!booking.ok) return booking;
  const person = checkContactField(input.contactPerson, 'contactPerson', 'Contact person');
  if (!person.ok) return person;
  const phone = checkPhone(input.phone);
  if (!phone.ok) return phone;
  const email = checkEmail(input.email);
  if (!email.ok) return email;
  // Built from named fields so action keys ("type") or extras never reach storage.
  const vendor: Vendor = {
    id: input.id,
    categoryId: input.categoryId,
    name: name.value,
    contactNote: note.value,
    contactPerson: person.value,
    phone: phone.value,
    email: email.value,
    status: statusInput.value.status,
    committedMinor: statusInput.value.committedMinor,
    schedule: [],
  };
  return ok({ ...plan, vendors: [...plan.vendors, vendor] });
}

interface VendorChanges {
  readonly categoryId?: string;
  readonly name?: string;
  readonly contactNote?: string;
  readonly contactPerson?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly status?: BookingStatus;
  readonly committedMinor?: number | null;
}

/** Applies the text and category parts of an update; the caller handles status and price. */
function applyVendorTextChanges(
  plan: Plan,
  current: Vendor,
  changes: VendorChanges,
): Result<Vendor> {
  let next: Vendor = current;
  if (changes.name !== undefined) {
    const name = checkName(changes.name, 'name', 'Vendor name');
    if (!name.ok) return name;
    next = { ...next, name: name.value };
  }
  if (changes.contactNote !== undefined) {
    const note = checkNote(changes.contactNote, 'contactNote');
    if (!note.ok) return note;
    next = { ...next, contactNote: note.value };
  }
  if (changes.contactPerson !== undefined) {
    const person = checkContactField(changes.contactPerson, 'contactPerson', 'Contact person');
    if (!person.ok) return person;
    next = { ...next, contactPerson: person.value };
  }
  if (changes.phone !== undefined) {
    const phone = checkPhone(changes.phone);
    if (!phone.ok) return phone;
    next = { ...next, phone: phone.value };
  }
  if (changes.email !== undefined) {
    const email = checkEmail(changes.email);
    if (!email.ok) return email;
    next = { ...next, email: email.value };
  }
  if (changes.categoryId !== undefined && changes.categoryId !== current.categoryId) {
    if (!plan.categories.some((c) => c.id === changes.categoryId))
      return fail('CATEGORY_NOT_FOUND', 'Choose an existing category.', 'categoryId');
    if (plan.expenses.some((e) => e.vendorId === current.id)) {
      return fail(
        'VENDOR_HAS_PAYMENTS',
        'This vendor already has payments recorded, so its category cannot change.',
        'categoryId',
      );
    }
    next = { ...next, categoryId: changes.categoryId };
  }
  return ok(next);
}

export function updateVendor(plan: Plan, id: string, changes: VendorChanges): Result<Plan> {
  const current = plan.vendors.find((v) => v.id === id);
  if (!current) return fail('VENDOR_NOT_FOUND', 'That vendor no longer exists.', 'id');
  const textApplied = applyVendorTextChanges(plan, current, changes);
  if (!textApplied.ok) return textApplied;
  let next: Vendor = textApplied.value;
  if (changes.status !== undefined || changes.committedMinor !== undefined) {
    // Explicit null (clearing the price) must survive, so absent is checked against
    // unknown-typed locals instead of ??, which would swallow the null.
    const statusRaw: unknown = changes.status;
    const committedRaw: unknown = changes.committedMinor;
    const statusInput = checkStatusInput(
      statusRaw === undefined ? next.status : statusRaw,
      committedRaw === undefined ? next.committedMinor : committedRaw,
    );
    if (!statusInput.ok) return statusInput;
    next = {
      ...next,
      status: statusInput.value.status,
      committedMinor: statusInput.value.committedMinor,
    };
  }
  const booking = checkBooking(next.status, next.committedMinor);
  if (!booking.ok) return booking;
  if (
    plan.vendors.some(
      (v) => v.id !== id && v.categoryId === next.categoryId && sameName(v.name, next.name),
    )
  ) {
    return fail(
      'DUPLICATE_VENDOR',
      'You already have a vendor with that name in this category.',
      'name',
    );
  }
  return ok({ ...plan, vendors: plan.vendors.map((v) => (v.id === id ? next : v)) });
}

export function deleteVendor(plan: Plan, id: string): Result<Plan> {
  if (!plan.vendors.some((v) => v.id === id))
    return fail('VENDOR_NOT_FOUND', 'That vendor no longer exists.', 'id');
  if (plan.expenses.some((e) => e.vendorId === id)) {
    return fail(
      'VENDOR_HAS_PAYMENTS',
      'This vendor has payments recorded. Mark it cancelled instead of deleting it.',
      'id',
    );
  }
  return ok({ ...plan, vendors: plan.vendors.filter((v) => v.id !== id) });
}

export function setSchedule(
  plan: Plan,
  id: string,
  schedule: readonly InstalmentInput[],
): Result<Plan> {
  if (!plan.vendors.some((v) => v.id === id))
    return fail('VENDOR_NOT_FOUND', 'That vendor no longer exists.', 'id');
  const raw: unknown = schedule;
  if (!Array.isArray(raw))
    return fail('INVALID_LIST', 'The payment schedule must be a list.', 'schedule');
  const list = raw as readonly Instalment[];
  if (list.length > MAX_INSTALMENTS_PER_VENDOR) {
    return fail(
      'TOO_MANY_INSTALMENTS',
      `A vendor can have at most ${MAX_INSTALMENTS_PER_VENDOR} scheduled payments.`,
      'schedule',
    );
  }
  const ids = new Set<string>();
  for (const item of list) {
    const failure = firstFailure([
      checkId(item.id, 'schedule'),
      // The kind arrives from untrusted input (forms, storage, AI): validate against the
      // closed set, never store it raw.
      checkEnum((item as { kind?: unknown }).kind, PAYMENT_KINDS, 'kind', 'Payment kind'),
      checkDate(item.dueISO, 'schedule'),
      checkAmount(item.amountMinor, 'schedule', 'Instalment'),
      checkNote((item as { note?: unknown }).note ?? '', 'schedule'),
    ]);
    if (failure) return failure;
    if (item.amountMinor === 0)
      return fail('INVALID_AMOUNT', 'A scheduled payment must be more than zero.', 'schedule');
    if (
      ids.has(item.id) ||
      plan.vendors.some((v) => v.id !== id && v.schedule.some((i) => i.id === item.id))
    ) {
      return fail('DUPLICATE_ID', 'Each scheduled payment needs a unique id.', 'schedule');
    }
    ids.add(item.id);
  }
  const lost = plan.expenses.find(
    (e) => e.vendorId === id && e.instalmentId !== null && !ids.has(e.instalmentId),
  );
  if (lost)
    return fail(
      'INSTALMENT_ALREADY_PAID',
      'A scheduled payment that is already marked paid cannot be removed.',
      'schedule',
    );
  // Rebuilt from named fields: a caller that omits `note` still stores a defined string.
  const normalized: readonly Instalment[] = list.map((item) => ({
    id: item.id,
    kind: item.kind,
    dueISO: item.dueISO,
    amountMinor: item.amountMinor,
    note: typeof item.note === 'string' ? item.note : '',
  }));
  return ok({
    ...plan,
    vendors: plan.vendors.map((v) => (v.id === id ? { ...v, schedule: normalized } : v)),
  });
}
