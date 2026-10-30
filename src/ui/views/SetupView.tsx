import { useState } from 'react';
import { createPlan } from '../../engine/create';
import { parseMajorAmount } from '../../engine/money';
import type { Occasion, Plan } from '../../engine/types';
import { localToday, localeDefaults } from '../../lib/format';
import { savePlan } from '../../state/persistence';
import { usePlan } from '../../state/store';
import { text } from './form';
import { IntakeBox } from './IntakeBox';

const OCCASION_OPTIONS: readonly { readonly value: Occasion; readonly label: string }[] = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'birthday', label: "Kid's birthday" },
  { value: 'community', label: 'Community event' },
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY'] as const;

export interface Prefill {
  readonly name?: string;
  readonly dateISO?: string;
  readonly guests?: string;
  readonly budget?: string;
}

/**
 * Event setup: describe the event in your own words (AI fills the form when available; the
 * form always works by hand), then create or edit the plan. The engine validates everything.
 */
export function SetupView({ onCreated, plan }: { onCreated: () => void; plan: Plan | null }) {
  const store = usePlan();
  const defaults = localeDefaults();
  const [name, setName] = useState(plan?.name ?? '');
  const [occasion, setOccasion] = useState<Occasion>(plan?.occasion ?? 'wedding');
  const [dateISO, setDateISO] = useState(plan?.dateISO ?? '');
  const [guests, setGuests] = useState(plan === null ? '' : String(plan.guestTarget));
  const [budget, setBudget] = useState(plan === null ? '' : String(plan.budgetMinor / 10 ** 2));
  const [currency, setCurrency] = useState<string>(plan?.currency ?? defaults.currency);
  const [locale] = useState(plan?.locale ?? defaults.locale);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  function applyPrefill(values: Prefill) {
    const setters: Record<string, (value: string) => void> = {
      name: setName,
      dateISO: setDateISO,
      guests: setGuests,
      budget: setBudget,
    };
    for (const [key, value] of Object.entries(values) as [keyof Prefill, string][]) {
      setters[key]?.(value);
    }
  }

  function submit(data: FormData) {
    const result = buildPlan(data, currency, locale, plan);
    if (!result.ok) {
      setError(
        result.error.field === undefined
          ? { message: result.error.message }
          : { message: result.error.message, field: result.error.field },
      );
      return;
    }
    setError(null);
    const next = plan === null ? result.value.plan : carryWorkOver(result.value.plan, plan);
    const saved = savePlan(next);
    if (!saved.ok && saved.reason !== null) setError({ message: saved.reason });
    store.replace(next);
    onCreated();
  }

  return (
    <>
      <IntakeBox occasion={occasion} onPrefill={applyPrefill} />
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
            <label htmlFor="f-budget">Total budget in major units (e.g. 800000)</label>
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
                setCurrency(event.target.value);
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
