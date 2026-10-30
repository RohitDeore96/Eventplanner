import { MAX_AMOUNT_MINOR } from '../config/limits';

/** All money is an integer count of minor units (cents, paise, yen). Never a float. */
export type Minor = number;

const DECIMAL_PATTERN = /^(\d{1,15})(?:\.(\d{1,6}))?$/;
const FALLBACK_LOCALE = 'en';

let supported: ReadonlySet<string> | undefined;

function isSupportedCurrency(code: string): boolean {
  supported ??= new Set(Intl.supportedValuesOf('currency'));
  return supported.has(code);
}

/** Number of decimal places for a currency (JPY 0, USD 2, KWD 3); null for unknown codes. */
export function currencyExponent(code: string): number | null {
  if (!isSupportedCurrency(code)) return null;
  const digits = new Intl.NumberFormat(FALLBACK_LOCALE, {
    style: 'currency',
    currency: code,
  }).resolvedOptions().maximumFractionDigits;
  return digits ?? null;
}

export function isValidMinor(value: unknown): value is Minor {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_AMOUNT_MINOR
  );
}

/**
 * Parse a user-typed major-unit amount ("1250.50") into minor units without touching floats.
 * Returns null for negatives, thousands separators, too many decimals, or values over the cap.
 */
export function parseMajorAmount(input: string, currency: string): Minor | null {
  const exponent = currencyExponent(currency);
  if (exponent === null) return null;
  const match = DECIMAL_PATTERN.exec(input.trim());
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) return null;
  const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  return minor > BigInt(MAX_AMOUNT_MINOR) ? null : Number(minor);
}

/** Display only. Falls back to English formatting if the locale tag is invalid. */
export function formatMoney(minor: Minor, currency: string, locale: string): string {
  const exponent = currencyExponent(currency);
  if (exponent === null) return String(minor);
  const major = minor / 10 ** exponent;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major);
  } catch {
    return new Intl.NumberFormat(FALLBACK_LOCALE, { style: 'currency', currency }).format(major);
  }
}

/**
 * Largest-remainder allocation: splits `total` across integer `weights` so the parts always sum
 * to `total` exactly. Ties go to the lowest index. Uses BigInt so total*weight cannot overflow.
 * Returns null when weights are empty, non-integer, negative, or all zero.
 */
export function allocateByWeights(total: Minor, weights: readonly number[]): Minor[] | null {
  if (!isValidMinor(total)) return null;
  if (!weights.every((w) => Number.isInteger(w) && w >= 0)) return null;
  const weightSum = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  if (weightSum === 0n) return null;

  const bigTotal = BigInt(total);
  const shares = weights.map((w, index) => {
    const product = bigTotal * BigInt(w);
    return { index, base: product / weightSum, remainder: product % weightSum };
  });
  const allocated = shares.reduce((acc, s) => acc + s.base, 0n);
  let leftover = Number(bigTotal - allocated);

  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const bonus = new Set<number>();
  for (const share of byRemainder) {
    if (leftover === 0) break;
    bonus.add(share.index);
    leftover -= 1;
  }
  return shares.map((s) => Number(s.base) + (bonus.has(s.index) ? 1 : 0));
}

export function sumMinor(values: readonly Minor[]): Minor {
  return values.reduce((acc, v) => acc + v, 0);
}
