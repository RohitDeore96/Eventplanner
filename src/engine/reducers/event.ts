import type { EventChanges } from '../actions';
import { daysBetween } from '../dates';
import { currencyExponent, isValidMinor } from '../money';
import { fail, ok, type Result } from '../result';
import type { Plan } from '../types';
import { checkDate, checkGuestCount, checkName } from '../validate';

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

const stepCurrency: Step = (plan, { currency }) => {
  if (currency === undefined) return ok(plan);
  const after = currencyExponent(currency);
  if (after === null) {
    return fail(
      'INVALID_CURRENCY',
      'Choose a valid 3-letter currency code such as INR, USD or JPY.',
      'currency',
    );
  }
  if (currencyExponent(plan.currency) !== after) {
    return fail(
      'CURRENCY_DECIMALS_DIFFER',
      'These currencies use different decimal places, so existing amounts would change meaning. Create a new event in the new currency instead.',
      'currency',
    );
  }
  return ok({ ...plan, currency });
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
