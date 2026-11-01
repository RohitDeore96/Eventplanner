import { createPlan } from '../../../engine/create';
import { currencyExponent, parseMajorAmount } from '../../../engine/money';
import { currencyChangeError } from '../../../engine/reducers/event';
import type { Occasion, Plan } from '../../../engine/types';
import { localToday } from '../../../lib/format';
import { asOccasion, type Prefill } from '../IntakeBox';
import { text } from '../form';

/**
 * Everything the setup form's submit button needs, decided outside React so it stays
 * under the complexity gate: seed values for create/edit, the currency-change policy,
 * plan building through the engine, and the carry-over of the family's real work on edit.
 */

/** Applies parsed intake values to the form's setters; occasion goes through a type guard. */
export function dispatchPrefill(
  values: Prefill,
  set: {
    readonly name: (value: string) => void;
    readonly dateISO: (value: string) => void;
    readonly guests: (value: string) => void;
    readonly budget: (value: string) => void;
    readonly occasion: (value: Occasion) => void;
  },
): void {
  const parsedOccasion = values.occasion !== undefined ? asOccasion(values.occasion) : null;
  if (parsedOccasion !== null) set.occasion(parsedOccasion);
  if (values.name !== undefined) set.name(values.name);
  if (values.dateISO !== undefined) set.dateISO(values.dateISO);
  if (values.guests !== undefined) set.guests(values.guests);
  if (values.budget !== undefined) set.budget(values.budget);
}

export type Submission =
  | { readonly kind: 'error'; readonly message: string; readonly field?: string }
  | { readonly kind: 'ready'; readonly next: Plan };

/** Everything the submit button needs, decided outside React so it stays under the complexity gate. */
export function resolveSubmission(
  data: FormData,
  currency: string,
  locale: string,
  plan: Plan | null,
): Submission {
  // Currency policy: locked once records exist; otherwise the budget is re-entered fresh
  // (the form clears it on change), so no amount is ever silently reinterpreted.
  if (plan !== null) {
    const issue = currencyChangeError(plan, currency, text(data, 'budget').trim().length > 0);
    if (issue !== null) {
      return { kind: 'error', message: issue.message, field: issue.field };
    }
  }
  const result = buildPlan(data, currency, locale, plan);
  if (!result.ok) {
    return result.error.field === undefined
      ? { kind: 'error', message: result.error.message }
      : { kind: 'error', message: result.error.message, field: result.error.field };
  }
  const next = plan === null ? result.value.plan : carryWorkOver(result.value.plan, plan);
  return { kind: 'ready', next };
}

export interface SetupSeed {
  readonly name: string;
  readonly occasion: Occasion;
  readonly dateISO: string;
  readonly guests: string;
  readonly budget: string;
  readonly currency: string;
  readonly locale: string;
}

/** Initial form values for create (blank) or edit (the plan's own values, exponent-correct). */
export function setupSeed(
  plan: Plan | null,
  defaults: { readonly currency: string; readonly locale: string },
): SetupSeed {
  if (plan === null) {
    return {
      name: '',
      occasion: 'wedding',
      dateISO: '',
      guests: '',
      budget: '',
      currency: defaults.currency,
      locale: defaults.locale,
    };
  }
  return {
    name: plan.name,
    occasion: plan.occasion,
    dateISO: plan.dateISO,
    guests: String(plan.guestTarget),
    budget: displayMajor(plan.budgetMinor, plan.currency),
    currency: plan.currency,
    locale: plan.locale,
  };
}

/** Minor -> major for the edit form's input, with the plan currency's own exponent. */
export function displayMajor(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  return exponent === null ? String(minor) : String(Math.round(minor / 10 ** exponent));
}

/** Builds the createPlan input from form data; parse failures become engine-validated rejections. */
function buildPlan(
  data: FormData,
  currency: string,
  locale: string,
  plan: Plan | null,
): ReturnType<typeof createPlan> {
  const budgetMinor = parseMajorAmount(text(data, 'budget'), currency);
  return createPlan(
    {
      id: plan?.id ?? `ev-${Date.now().toString(36)}`,
      name: text(data, 'name'),
      occasion: text(data, 'occasion') as Occasion,
      dateISO: text(data, 'dateISO'),
      currency,
      locale,
      budgetMinor: budgetMinor ?? -1,
      guestTarget: Number(text(data, 'guests')),
    },
    localToday(),
  );
}

/**
 * createPlan rebuilds the defaults; editing must keep the family's real work: vendors,
 * expenses, guests and manual tasks carry over, and changed basics re-derive the rest.
 * The currency is only adopted after currencyChangeError() passed in submit().
 */
function carryWorkOver(fresh: Plan, current: Plan): Plan {
  return {
    ...current,
    name: fresh.name,
    occasion: fresh.occasion,
    dateISO: fresh.dateISO,
    currency: fresh.currency,
    locale: fresh.locale,
    budgetMinor: fresh.budgetMinor,
    guestTarget: fresh.guestTarget,
    categories: fresh.categories,
  };
}
