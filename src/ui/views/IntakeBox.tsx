import { useState } from 'react';
import { currencyExponent } from '../../engine/money';
import type { Occasion } from '../../engine/types';
import { aiClient } from '../../lib/aiClient';

export interface Prefill {
  readonly name?: string;
  readonly occasion?: string;
  readonly dateISO?: string;
  readonly guests?: string;
  readonly budget?: string;
}

/**
 * "Describe your event" box. Calls /api/parse-intake; with no key or AI down, the endpoint's
 * deterministic fallback answers and the source label says so. The form below always works.
 *
 * Money contract: the API answers in true minor units; the only conversion here is
 * minor -> major FOR DISPLAY in the form input, using the selected currency's exponent
 * (JPY has none, so no division happens for yen).
 */
export function IntakeBox({
  currency,
  onPrefill,
}: {
  currency: string;
  onPrefill: (values: Prefill) => void;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runIntake() {
    setBusy(true);
    setStatus('Reading your description…');
    try {
      const reply = await aiClient.parseIntake(text, currency);
      const parsed = reply.body;
      const exponent = currencyExponent(currency);
      onPrefill({
        ...(parsed.name !== null ? { name: parsed.name } : {}),
        ...(parsed.occasion !== null ? { occasion: parsed.occasion } : {}),
        ...(parsed.dateISO !== null ? { dateISO: parsed.dateISO } : {}),
        ...(parsed.guests !== null ? { guests: String(parsed.guests) } : {}),
        ...(parsed.budgetMinor !== null && exponent !== null
          ? { budget: String(Math.round(parsed.budgetMinor / 10 ** exponent)) }
          : {}),
      });
      const filled = [
        parsed.occasion,
        parsed.dateISO,
        parsed.guests !== null ? `${parsed.guests} guests` : null,
        parsed.budgetMinor !== null ? 'budget' : null,
      ].filter((part) => part !== null);
      setStatus(
        filled.length > 0
          ? `Filled ${filled.join(', ')} from your description — check it below. (answered by: ${reply.source})`
          : `I could not read clear details — fill the form below. (answered by: ${reply.source})`,
      );
    } catch {
      setStatus('The reader is unavailable. Fill the form below — it takes under a minute.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="intake-title">
      <h2 id="intake-title">Describe your event</h2>
      <label htmlFor="intake-text">
        For example: "Shaadi in Pune, 200 guests, 8 lakh budget, mid-February"
      </label>
      <textarea
        id="intake-text"
        value={text}
        maxLength={1000}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="row">
        <button
          type="button"
          onClick={() => {
            void runIntake();
          }}
          disabled={busy || text.trim().length === 0}
        >
          {busy ? 'Reading…' : 'Fill form from description'}
        </button>
        {status !== null && (
          <p className="muted" role="status">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}

/** Guard so a bad cast can never leak into the typed prefill. */
export function asOccasion(value: string): Occasion | null {
  return value === 'wedding' || value === 'birthday' || value === 'community' ? value : null;
}
