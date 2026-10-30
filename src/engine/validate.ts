import { MAX_GUESTS, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../config/limits';
import { isValidISODate, type ISODate } from './dates';
import { isValidMinor } from './money';
import { fail, ok, type Result } from './result';

export function checkName(value: string, field: string, label: string): Result<string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fail('NAME_REQUIRED', `${label} is required.`, field);
  if (trimmed.length > MAX_NAME_LENGTH) {
    return fail('NAME_TOO_LONG', `${label} must be ${MAX_NAME_LENGTH} characters or fewer.`, field);
  }
  return ok(trimmed);
}

export function checkNote(value: string, field: string): Result<string> {
  const trimmed = value.trim();
  return trimmed.length > MAX_NOTE_LENGTH
    ? fail('NOTE_TOO_LONG', `Notes must be ${MAX_NOTE_LENGTH} characters or fewer.`, field)
    : ok(trimmed);
}

export function checkAmount(value: number, field: string, label: string): Result<number> {
  return isValidMinor(value)
    ? ok(value)
    : fail(
        'INVALID_AMOUNT',
        `${label} must be a whole number of minor units, zero or more, within the supported maximum.`,
        field,
      );
}

export function checkDate(value: string, field: string): Result<ISODate> {
  return isValidISODate(value)
    ? ok(value)
    : fail('INVALID_DATE', 'Enter a real date as YYYY-MM-DD.', field);
}

export function checkGuestCount(value: number, field: string): Result<number> {
  return Number.isInteger(value) && value >= 1 && value <= MAX_GUESTS
    ? ok(value)
    : fail('INVALID_GUESTS', `Guests must be a whole number between 1 and ${MAX_GUESTS}.`, field);
}

export function checkId(value: string, field: string): Result<string> {
  return /^[A-Za-z0-9_-]{1,100}$/.test(value)
    ? ok(value)
    : fail('INVALID_ID', 'Identifier is not valid.', field);
}
