import { useState } from 'react';
import { createPlan } from '../../engine/create';
import { currencyExponent, parseMajorAmount } from '../../engine/money';
import { currencyChangeError } from '../../engine/reducers/event';
import type { Occasion, Plan } from '../../engine/types';
import { localToday, localeDefaults } from '../../lib/format';
import { savePlan } from '../../state/persistence';
import { usePlan } from '../../state/store';
import { text } from './form';
import { IntakeBox, asOccasion, type Prefill } from './IntakeBox';

export const OCCASION_OPTIONS: readonly { readonly value: Occasion; readonly label: string }[] = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'birthday', label: "Kid's birthday" },
  { value: 'community', label: 'Community event' },
  { value: 'milestone', label: 'Milestone celebration' },
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'KWD'] as const;

/** Applies parsed intake values to the form's setters; occasion goes through a type guard. */
function dispatchPrefill(
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

type Submission =
  | { readonly kind: 'error'; readonly message: string; readonly field?: string }
  | { readonly kind: 'ready'; readonly next: Plan };

/** Everything the submit button needs, decided outside React so it stays under the complexity gate. */
function resolveSubmission(
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

interface SetupSeed {
  readonly name: string;
  readonly occasion: Occasion;
  readonly dateISO: string;
  readonly guests: string;
  readonly budget: string;
  readonly currency: string;
  readonly locale: string;
}

/** Initial form values for create (blank) or edit (the plan's own values, exponent-correct). */
function setupSeed(
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

/**
 * Event setup: describe the event in your own words (AI fills the form when available; the
 * form always works by hand), then create or edit the plan. The engine validates everything.
 */
export function SetupView({ onCreated, plan }: { onCreated: () => void; plan: Plan | null }) {
  const store = usePlan();
  const defaults = localeDefaults();
  const [seed] = useState<SetupSeed>(() => setupSeed(plan, defaults));
  const [name, setName] = useState(seed.name);
  const [occasion, setOccasion] = useState<Occasion>(seed.occasion);
  const [dateISO, setDateISO] = useState(seed.dateISO);
  const [guests, setGuests] = useState(seed.guests);
  const [budget, setBudget] = useState(seed.budget);
  const [currency, setCurrency] = useState<string>(seed.currency);
  const [currencyHint, setCurrencyHint] = useState<string | null>(null);
  const [locale] = useState(seed.locale);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  function applyPrefill(values: Prefill) {
    dispatchPrefill(values, {
      name: setName,
      dateISO: setDateISO,
      guests: setGuests,
      budget: setBudget,
      occasion: setOccasion,
    });
  }

  function submit(data: FormData) {
    const outcome = resolveSubmission(data, currency, locale, plan);
    if (outcome.kind === 'error') {
      setError(
        outcome.field === undefined
          ? { message: outcome.message }
          : { message: outcome.message, field: outcome.field },
      );
      return;
    }
    setError(null);
    const saved = savePlan(outcome.next);
    if (!saved.ok && saved.reason !== null) setError({ message: saved.reason });
    store.replace(outcome.next);
    onCreated();
  }

  return (
    <>
      <IntakeBox currency={currency} onPrefill={applyPrefill} />
      <form
        className="card"
        aria-labelledby="setup-title"
        onSubmit={(event) => {
          event.preventDefault();
          submit(new FormData(event.currentTarget));
        }}
      >
        <h2 id="setup-title">{plan === null ? 'Plan your utsav' : 'Edit your event'}</h2>
        <FormError error={error} />
        <div className="grid">
          <div>
            <label htmlFor="f-name">Event name</label>
            <input
              id="f-name"
              name="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              required
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor="f-occasion">Occasion</label>
            <select
              id="f-occasion"
              name="occasion"
              value={occasion}
              onChange={(event) => {
                setOccasion(event.target.value as Occasion);
              }}
            >
              {OCCASION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-date">Event date</label>
            <input
              id="f-date"
              name="dateISO"
              type="date"
              value={dateISO}
              onChange={(event) => {
                setDateISO(event.target.value);
              }}
              required
            />
          </div>
          <div>
            <label htmlFor="f-guests">Expected guests</label>
            <input
              id="f-guests"
              name="guests"
              type="number"
              min={1}
              max={100000}
              value={guests}
              onChange={(event) => {
                setGuests(event.target.value);
              }}
              required
            />
          </div>
          <div>
            <label htmlFor="f-budget">Total budget in {currency} (e.g. 800000)</label>
            <input
              id="f-budget"
              name="budget"
              inputMode="decimal"
              value={budget}
              onChange={(event) => {
                setBudget(event.target.value);
              }}
              required
            />
          </div>
          <div>
            <label htmlFor="f-currency">Currency</label>
            <select
              id="f-currency"
              value={currency}
              onChange={(event) => {
                const next = event.target.value;
                setCurrency(next);
                // Amounts are never converted: the budget must be typed fresh in the new
                // currency, in the new currency's own decimal system.
                setBudget('');
                setCurrencyHint(
                  `Currency set to ${next}. Enter your budget in ${next} — existing amounts are not converted automatically.`,
                );
              }}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
        </div>
        {currencyHint !== null && (
          <p className="muted" role="status">
            {currencyHint}
          </p>
        )}
        <p className="muted">Locale {locale} — used for all money and date formatting.</p>
        <button type="submit" className="primary">
          {plan === null ? 'Create the plan' : 'Save changes'}
        </button>
      </form>
    </>
  );
}

function FormError({ error }: { error: { message: string; field?: string } | null }) {
  if (error === null) return null;
  return (
    <p className="field-error" role="alert">
      {error.message}
    </p>
  );
}

/** Minor -> major for the edit form's input, with the plan currency's own exponent. */
function displayMajor(minor: number, currency: string): string {
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
