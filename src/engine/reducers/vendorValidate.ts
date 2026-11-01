import { BOOKING_STATUSES } from '../enums.js';
import { fail, ok, type Result } from '../result.js';
import type { BookingStatus } from '../types.js';
import { checkAmount, checkEnum } from '../validate.js';

/**
 * Field-level validation for vendor reducer actions. Every value here arrives from
 * untrusted input (forms, storage, AI patches), so each field is checked against closed
 * sets and length caps before the reducers touch the plan. Error codes and messages are
 * part of the public contract — the UI maps them to spoken notices.
 */

export const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/** A booked vendor must carry an agreed price; any price present must be a valid amount. */
export function checkBooking(status: BookingStatus, committedMinor: number | null): Result<null> {
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
export function checkStatusInput(
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

export interface NewVendor {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly contactNote: string;
  readonly contactPerson?: string;
  readonly phone?: string;
  readonly email?: string;
  readonly status: BookingStatus;
  readonly committedMinor: number | null;
}

/** Optional contact details: trimmed text with length caps; empty string when absent. */
export function checkContactField(value: unknown, field: string, label: string): Result<string> {
  if (value === undefined || value === null) return ok('');
  if (typeof value !== 'string') return fail('INVALID_TEXT', `${label} must be text.`, field);
  const trimmed = value.trim();
  return trimmed.length > 120
    ? fail('TEXT_TOO_LONG', `${label} must be 120 characters or fewer.`, field)
    : ok(trimmed);
}

export function checkPhone(value: unknown): Result<string> {
  if (value === undefined || value === null) return ok('');
  if (typeof value !== 'string') return fail('INVALID_TEXT', 'Phone must be text.', 'phone');
  const trimmed = value.trim();
  if (trimmed.length > 40) {
    return fail('TEXT_TOO_LONG', 'Phone must be 40 characters or fewer.', 'phone');
  }
  return ok(trimmed);
}

export function checkEmail(value: unknown): Result<string> {
  if (value === undefined || value === null) return ok('');
  if (typeof value !== 'string') return fail('INVALID_TEXT', 'Email must be text.', 'email');
  const trimmed = value.trim();
  if (trimmed.length > 120) {
    return fail('TEXT_TOO_LONG', 'Email must be 120 characters or fewer.', 'email');
  }
  // Only a light shape check: a full RFC parser rejects real-world addresses.
  if (trimmed.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return fail('INVALID_EMAIL', 'That email address does not look right.', 'email');
  }
  return ok(trimmed);
}
