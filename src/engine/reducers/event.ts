import type { EventChanges } from '../actions.js';
import { daysBetween } from '../dates.js';
import { currencyExponent, isValidMinor } from '../money.js';
import { fail, ok, type Result } from '../result.js';
import type { Plan } from '../types.js';
import { checkDate, checkGuestCount, checkName } from '../validate.js';

type Step = (plan: Plan, changes: EventChanges, today: string) => Result<Plan>;

const stepName: Step = (plan, { name }) => {
  if (name === undefined) return ok(plan);
  const checked = checkName(name, 'name', 'Event name');
  return checked.ok ? ok({ ...plan, name: checked.value }) : checked;
};

const stepDate: Step = (plan, { dateISO }, today) => {
  if (dateISO === undefined) return ok(plan);
  const checked = checkDate(dateISO, 'dateISO');
  if (!checked.ok) return checked;
  if ((daysBetween(today, dateISO) ?? 0) < 0) {
    return fail('DATE_IN_PAST', 'The event date cannot be in the past.', 'dateISO');
  }
  return ok({ ...plan, dateISO });
};

const stepGuests: Step = (plan, { guestTarget }) => {
  if (guestTarget === undefined) return ok(plan);
  const checked = checkGuestCount(guestTarget, 'guestTarget');
  return checked.ok ? ok({ ...plan, guestTarget }) : checked;
};

const stepBudget: Step = (plan, { budgetMinor }) => {
  if (budgetMinor === undefined) return ok(plan);
  if (!isValidMinor(budgetMinor) || budgetMinor === 0) {
    return fail(
      'INVALID_BUDGET',
      'Budget must be greater than zero and within the supported maximum.',
      'budgetMinor',
    );
  }
  return ok({ ...plan, budgetMinor });
};

export interface CurrencyIssue {
  readonly code: string;
  readonly message: string;
  readonly field: string;
}

/**
 * The one currency-change policy, shared by the reducer and the setup form:
 * locked once financial records exist; never silently reinterpreted; same-decimal changes
 * require the budget to be re-entered in the new currency (amounts are never converted,
 * because no exchange rate is ever invented).
 */
export function currencyChangeError(
  plan: Plan,
  next: string,
  budgetRestated: boolean,
): CurrencyIssue | null {
  if (next === plan.currency) return null;
  const after = currencyExponent(next);
  if (after === null) {
    return {
      code: 'INVALID_CURRENCY',
      message: 'Choose a valid 3-letter currency code such as INR, USD or JPY.',
      field: 'currency',
    };
  }
  const hasRecords =
    plan.expenses.length > 0 ||
    plan.vendors.some((v) => v.committedMinor !== null || v.schedule.length > 0);
  if (hasRecords) {
    return {
      code: 'CURRENCY_LOCKED',
      message:
        'This plan already has vendor agreements or payments, so the currency is locked — switching would silently reinterpret every amount. Create a new event in the new currency instead.',
      field: 'currency',
    };
  }
  if (currencyExponent(plan.currency) !== after) {
    return {
      code: 'CURRENCY_DECIMALS_DIFFER',
      message:
        'These currencies use different decimal places, so existing amounts would change meaning. Create a new event in the new currency instead.',
      field: 'currency',
    };
  }
  if (!budgetRestated) {
    return {
      code: 'CURRENCY_NEEDS_BUDGET',
      message: `Enter your budget again in ${next} — amounts are never converted automatically.`,
      field: 'budgetMinor',
    };
  }
  return null;
}

const stepCurrency: Step = (plan, { currency, budgetMinor }) => {
  if (currency === undefined) return ok(plan);
  const issue = currencyChangeError(plan, currency, budgetMinor !== undefined);
  return issue === null ? ok({ ...plan, currency }) : fail(issue.code, issue.message, issue.field);
};

const stepLocale: Step = (plan, { locale }) =>
  ok(locale === undefined ? plan : { ...plan, locale });

const STEPS: readonly Step[] = [
  stepName,
  stepDate,
  stepGuests,
  stepBudget,
  stepCurrency,
  stepLocale,
];

export function updateEvent(plan: Plan, changes: EventChanges, today: string): Result<Plan> {
  let current: Result<Plan> = ok(plan);
  for (const step of STEPS) {
    if (!current.ok) break;
    current = step(current.value, changes, today);
  }
  return current;
}
