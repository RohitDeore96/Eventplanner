import { formatMoney } from '../engine/money';
import type { Plan } from '../engine/types';

/** The user's local calendar date (not UTC), for the engine's `today` parameter. */
export function localToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Locale default: India gets INR and en-IN; everything else from the browser, user can change both. */
export function localeDefaults(): { locale: string; currency: string } {
  const languages = typeof navigator !== 'undefined' ? navigator.languages : [];
  const primary = languages[0] ?? 'en-IN';
  const isIndia = primary.toLowerCase().startsWith('en-in') || primary.toLowerCase() === 'hi';
  return {
    locale: isIndia ? 'en-IN' : primary,
    currency: isIndia ? 'INR' : 'USD',
  };
}

/** Display-only wrapper around the engine's formatter; the UI never does money arithmetic. */
export function money(minor: number, plan: Plan): string {
  return formatMoney(minor, plan.currency, plan.locale);
}
