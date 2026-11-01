import { useState } from 'react';
import type { Occasion, Plan } from '../../engine/types';
import { localeDefaults } from '../../lib/format';
import { savePlan } from '../../state/persistence';
import { usePlan } from '../../state/store';
import { IntakeBox, type Prefill } from './IntakeBox';
import { dispatchPrefill, resolveSubmission, setupSeed } from './setup/setupSubmit';

export const OCCASION_OPTIONS: readonly { readonly value: Occasion; readonly label: string }[] = [
  { value: 'wedding', label: 'Wedding' },
  { value: 'birthday', label: "Kid's birthday" },
  { value: 'community', label: 'Community event' },
  { value: 'milestone', label: 'Milestone celebration' },
];

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY', 'KWD'] as const;

/**
 * Event setup: describe the event in your own words (AI fills the form when available; the
 * form always works by hand), then create or edit the plan. The engine validates everything.
 * Submission decisions live in `setup/setupSubmit.ts`.
 */
export function SetupView({ onCreated, plan }: { onCreated: () => void; plan: Plan | null }) {
  const store = usePlan();
  const defaults = localeDefaults();
  const [seed] = useState(() => setupSeed(plan, defaults));
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
