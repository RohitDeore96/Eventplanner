import { useState } from 'react';
import { aiClient } from '../../lib/aiClient';

export interface Prefill {
  readonly name?: string;
  readonly dateISO?: string;
  readonly guests?: string;
  readonly budget?: string;
}

/**
 * "Describe your event" box. Calls /api/parse-intake; with no key or AI down, the endpoint's
 * deterministic fallback answers and the source label says so. The form below always works.
 */
export function IntakeBox({
  onPrefill,
}: {
  onPrefill: (values: Prefill) => void;
  occasion?: string;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runIntake() {
    setBusy(true);
    setStatus('Reading your description…');
    try {
      const reply = await aiClient.parseIntake(text);
      const parsed = reply.body;
      onPrefill({
        ...(parsed.name !== null ? { name: parsed.name } : {}),
        ...(parsed.dateISO !== null ? { dateISO: parsed.dateISO } : {}),
        ...(parsed.guests !== null ? { guests: String(parsed.guests) } : {}),
        ...(parsed.budgetMinor !== null
          ? { budget: String(Math.round(parsed.budgetMinor / 100)) }
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
