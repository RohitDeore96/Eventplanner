import { MAX_INSTALMENTS_PER_VENDOR, MAX_VENDORS } from '../../config/limits';
import { BOOKING_STATUSES, PAYMENT_KINDS } from '../enums';
import { fail, ok, type Result } from '../result';
import type { BookingStatus, Instalment, Plan, Vendor } from '../types';
import { checkAmount, checkDate, checkEnum, checkId, checkName, checkNote } from '../validate';

function firstFailure(results: readonly Result<unknown>[]): Result<never> | undefined {
  for (const result of results) if (!result.ok) return result;
  return undefined;
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function checkBooking(status: BookingStatus, committedMinor: number | null): Result<null> {
  if (committedMinor !== null) {
    const amount = checkAmount(committedMinor, 'committedMinor', 'Agreed price');
    if (!amount.ok) return amount;
  }
  return status === 'booked' && committedMinor === null
    ? fail(
        'BOOKED_NEEDS_PRICE',
        'Enter the agreed price before marking a vendor as booked.',
        'committedMinor',
      )
    : ok(null);
}

/** Validates status and agreed price that arrive from untrusted input. */
function checkStatusInput(
  status: unknown,
  committedMinor: unknown,
): Result<{ status: BookingStatus; committedMinor: number | null }> {
  const checked = checkEnum(status, BOOKING_STATUSES, 'status', 'Booking status');
  if (!checked.ok) return checked;
  if (committedMinor === null || committedMinor === undefined)
    return ok({ status: checked.value, committedMinor: null });
  const amount = checkAmount(committedMinor, 'committedMinor', 'Agreed price');
  return amount.ok ? ok({ status: checked.value, committedMinor: amount.value }) : amount;
}

interface NewVendor {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly contactNote: string;
  readonly status: BookingStatus;
  readonly committedMinor: number | null;
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
  // Built from named fields so action keys ("type") or extras never reach storage.
  const vendor: Vendor = {
    id: input.id,
    categoryId: input.categoryId,
    name: name.value,
    contactNote: note.value,
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

export function setSchedule(plan: Plan, id: string, schedule: readonly Instalment[]): Result<Plan> {
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
  return ok({ ...plan, vendors: plan.vendors.map((v) => (v.id === id ? { ...v, schedule } : v)) });
}
