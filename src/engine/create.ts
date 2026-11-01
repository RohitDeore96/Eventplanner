import { CATERING_KEY, CONTINGENCY_KEY } from '../config/limits.js';
import { daysBetween, type ISODate } from './dates.js';
import { OCCASIONS } from './enums.js';
import { generateMilestones } from './milestones.js';
import { allocateByWeights, currencyExponent, isValidMinor } from './money.js';
import { fail, ok, type Result } from './result.js';
import type { Occasion, Plan } from './types.js';
import { checkDate, checkGuestCount, checkId, checkName } from './validate.js';

interface SplitRow {
  readonly key: string;
  readonly name: string;
  /** Basis points of the budget. These are assumptions, not quotes. */
  readonly bps: number;
}

/** Starting allocations per occasion. Each list sums to 10,000 bps (tested). Only amounts are stored. */
export const DEFAULT_SPLITS: Readonly<Record<Occasion, readonly SplitRow[]>> = {
  wedding: [
    { key: 'venue', name: 'Venue', bps: 3000 },
    { key: CATERING_KEY, name: 'Catering', bps: 3000 },
    { key: 'photography', name: 'Photography', bps: 1000 },
    { key: 'decor', name: 'Decor and flowers', bps: 800 },
    { key: 'music', name: 'Music', bps: 600 },
    { key: 'attire', name: 'Attire', bps: 600 },
    { key: CONTINGENCY_KEY, name: 'Contingency', bps: 1000 },
  ],
  birthday: [
    { key: 'venue', name: 'Venue', bps: 2500 },
    { key: CATERING_KEY, name: 'Catering and cake', bps: 3500 },
    { key: 'decor', name: 'Decor', bps: 1200 },
    { key: 'entertainment', name: 'Entertainment', bps: 1500 },
    { key: CONTINGENCY_KEY, name: 'Contingency', bps: 1300 },
  ],
  community: [
    { key: 'venue', name: 'Venue and permits', bps: 2500 },
    { key: CATERING_KEY, name: 'Refreshments', bps: 3000 },
    { key: 'equipment', name: 'Equipment and sound', bps: 1500 },
    { key: 'promotion', name: 'Promotion', bps: 1000 },
    { key: 'volunteers', name: 'Volunteer support', bps: 800 },
    { key: CONTINGENCY_KEY, name: 'Contingency', bps: 1200 },
  ],
  milestone: [
    { key: 'venue', name: 'Venue', bps: 2500 },
    { key: CATERING_KEY, name: 'Catering and cake', bps: 2500 },
    { key: 'photography', name: 'Photography and portraits', bps: 1200 },
    { key: 'decor', name: 'Decor and memory lane', bps: 1000 },
    { key: 'entertainment', name: 'Entertainment and music', bps: 1200 },
    { key: 'favours', name: 'Gifts and favours', bps: 800 },
    { key: CONTINGENCY_KEY, name: 'Contingency', bps: 800 },
  ],
};

export interface NewEventInput {
  readonly id: string;
  readonly name: string;
  readonly occasion: Occasion;
  readonly dateISO: ISODate;
  readonly currency: string;
  readonly locale: string;
  readonly budgetMinor: number;
  readonly guestTarget: number;
}

export interface CreatedPlan {
  readonly plan: Plan;
  readonly notes: string[];
}

/**
 * Runtime occasion gate for values typed as text at their source (forms, AI, storage):
 * accepts only the closed occasion set and returns the create path's own rejection
 * otherwise. `createPlan` uses it, and the setup form calls it directly so its select
 * value is proven before it is typed as an `Occasion` — no unchecked assertion.
 */
export function parseOccasion(value: unknown): Result<Occasion> {
  return typeof value === 'string' && (OCCASIONS as readonly string[]).includes(value)
    ? ok(value as Occasion) // proven by the includes() check above (same idiom as checkEnum)
    : fail(
        'INVALID_OCCASION',
        'Choose one of: wedding, birthday, community, milestone.',
        'occasion',
      );
}

/** Validates the event basics, splits the budget with largest-remainder rounding, and adds milestones. */
export function createPlan(input: NewEventInput, today: ISODate): Result<CreatedPlan> {
  const id = checkId(input.id, 'id');
  if (!id.ok) return id;
  const name = checkName(input.name, 'name', 'Event name');
  if (!name.ok) return name;
  const occasion = parseOccasion(input.occasion);
  if (!occasion.ok) return occasion;
  const date = checkDate(input.dateISO, 'dateISO');
  if (!date.ok) return date;
  if ((daysBetween(today, input.dateISO) ?? 0) < 0) {
    return fail(
      'DATE_IN_PAST',
      'The event date has already passed. Choose a future date.',
      'dateISO',
    );
  }
  if (currencyExponent(input.currency) === null) {
    return fail(
      'INVALID_CURRENCY',
      'Choose a valid 3-letter currency code such as INR, USD or JPY.',
      'currency',
    );
  }
  if (!isValidMinor(input.budgetMinor) || input.budgetMinor === 0) {
    return fail(
      'INVALID_BUDGET',
      'Budget must be greater than zero and within the supported maximum.',
      'budgetMinor',
    );
  }
  const guests = checkGuestCount(input.guestTarget, 'guestTarget');
  if (!guests.ok) return guests;

  const splits = DEFAULT_SPLITS[occasion.value];
  const amounts = allocateByWeights(
    input.budgetMinor,
    splits.map((s) => s.bps),
  );
  if (amounts === null)
    return fail(
      'ALLOCATION_FAILED',
      'The budget could not be split across categories.',
      'budgetMinor',
    );

  const milestones = generateMilestones({
    occasion: occasion.value,
    dateISO: input.dateISO,
    guests: input.guestTarget,
    today,
    idPrefix: input.id,
  });
  if (!milestones.ok) return milestones;

  const plan: Plan = {
    id: input.id,
    name: name.value,
    occasion: occasion.value,
    dateISO: input.dateISO,
    currency: input.currency,
    locale: input.locale,
    budgetMinor: input.budgetMinor,
    guestTarget: input.guestTarget,
    categories: splits.map((s, index) => ({
      id: `${input.id}-cat-${s.key}`,
      key: s.key,
      name: s.name,
      plannedMinor: amounts[index] ?? 0,
      locked: false,
    })),
    vendors: [],
    expenses: [],
    tasks: milestones.value.tasks,
    guests: [],
    runSheet: [],
  };
  return ok({ plan, notes: milestones.value.notes });
}
