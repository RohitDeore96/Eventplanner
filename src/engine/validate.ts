import { MAX_GUESTS, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '../config/limits';
import { isValidISODate, type ISODate } from './dates';
import { isValidMinor } from './money';
import { fail, ok, type Result } from './result';

/**
 * Every validator accepts `unknown`: actions arrive from untrusted sources (free text, AI
 * patches, imported files, storage), so a wrong runtime type must return a typed failure
 * instead of throwing.
 */

export function checkName(value: unknown, field: string, label: string): Result<string> {
  if (typeof value !== 'string') return fail('INVALID_TEXT', `${label} must be text.`, field);
  const trimmed = value.trim();
  if (trimmed.length === 0) return fail('NAME_REQUIRED', `${label} is required.`, field);
  if (trimmed.length > MAX_NAME_LENGTH) {
    return fail('NAME_TOO_LONG', `${label} must be ${MAX_NAME_LENGTH} characters or fewer.`, field);
  }
  return ok(trimmed);
}

export function checkNote(value: unknown, field: string): Result<string> {
  if (typeof value !== 'string') return fail('INVALID_TEXT', 'Notes must be text.', field);
  const trimmed = value.trim();
  return trimmed.length > MAX_NOTE_LENGTH
    ? fail('NOTE_TOO_LONG', `Notes must be ${MAX_NOTE_LENGTH} characters or fewer.`, field)
    : ok(trimmed);
}

export function checkAmount(value: unknown, field: string, label: string): Result<number> {
  return isValidMinor(value)
    ? ok(value)
    : fail(
        'INVALID_AMOUNT',
        `${label} must be a whole number of minor units, zero or more, within the supported maximum.`,
        field,
      );
}

export function checkDate(value: unknown, field: string): Result<ISODate> {
  return typeof value === 'string' && isValidISODate(value)
    ? ok(value)
    : fail('INVALID_DATE', 'Enter a real date as YYYY-MM-DD.', field);
}

export function checkGuestCount(value: unknown, field: string): Result<number> {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_GUESTS
    ? ok(value)
    : fail('INVALID_GUESTS', `Guests must be a whole number between 1 and ${MAX_GUESTS}.`, field);
}

export function checkId(value: unknown, field: string): Result<string> {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
    ? ok(value)
    : fail('INVALID_ID', 'Identifier is not valid.', field);
}

/** Accepts only values from a closed set; used for enums read from untrusted input. */
export function checkEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  label: string,
): Result<T> {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? ok(value as T)
    : fail('INVALID_VALUE', `${label} must be one of: ${allowed.join(', ')}.`, field);
}

/**
 * Accepts only a real array of strings, de-duplicated, with a size cap. Item enums are
 * validated by the caller when a closed set applies.
 */
export function checkStringList(
  value: unknown,
  field: string,
  label: string,
  maxItems: number,
): Result<string[]> {
  if (!Array.isArray(value)) return fail('INVALID_LIST', `${label} must be a list.`, field);
  if (value.length > maxItems) {
    return fail('LIST_TOO_LONG', `${label} can hold at most ${maxItems} items.`, field);
  }
  for (const item of value) {
    if (typeof item !== 'string') {
      return fail('INVALID_LIST', `Every ${label.toLowerCase()} entry must be text.`, field);
    }
  }
  return ok([...new Set(value)]);
}
