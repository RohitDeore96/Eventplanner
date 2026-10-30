/**
 * Single source of truth for limits and defaults.
 * Everything here is a leaf constant: this module imports nothing.
 */

/** Largest money value we store, in minor units. Keeps sums well inside Number.MAX_SAFE_INTEGER. */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

export const MAX_GUESTS = 100_000;
export const MAX_PLUS_ONES = 10;
export const MAX_CATEGORIES = 30;
export const MAX_VENDORS = 200;
export const MAX_TASKS = 500;
export const MAX_EXPENSES = 5_000;
export const MAX_GUEST_RECORDS = 5_000;
export const MAX_INSTALMENTS_PER_VENDOR = 12;
export const MAX_DEPENDENCIES_PER_TASK = 10;

export const MAX_NAME_LENGTH = 80;
export const MAX_NOTE_LENGTH = 500;

/** Calendar years the engine accepts. Rejects absurd dates before they reach date arithmetic. */
export const MIN_YEAR = 1970;
export const MAX_YEAR = 2200;

/** AI patches are small by design; the engine dry-runs every op. */
export const MAX_PATCH_OPS = 10;
/** Undo depth. */
export const MAX_HISTORY = 50;

/** Contingency below this share of the budget (basis points) triggers a warning. */
export const CONTINGENCY_MIN_BPS = 500;
export const BPS_TOTAL = 10_000;

export const CONTINGENCY_KEY = 'contingency';
export const CATERING_KEY = 'catering';
