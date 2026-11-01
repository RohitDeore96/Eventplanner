import { checkEnum } from '../../engine/validate';

/** FormData safety: values may be File objects; the engine only accepts strings. */
export function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Parses a user-controlled form value against a runtime domain enum — the SAME closed
 * sets the engine's reducers enforce (engine/enums.ts) or a state module publishes.
 * Select options and checkbox values are user input, so the caller handles the null
 * case instead of asserting the cast; the engine re-validates every action regardless.
 */
export function parseEnum<T extends string>(value: string, allowed: readonly T[]): T | null {
  const checked = checkEnum(value, allowed, 'value', 'Value');
  return checked.ok ? checked.value : null;
}
