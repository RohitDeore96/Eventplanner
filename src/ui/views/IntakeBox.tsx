import { useState } from 'react';

export interface IntakePrefill {
  readonly name?: string;
  readonly dateISO?: string;
  readonly guests?: string;
  readonly budget?: string;
}

/**
 * "Describe your event" box. In M3 this calls POST /api/parse-intake (Gemini) with a
 * deterministic fallback; until the API ships, the box states plainly that it is offline
 * so nothing is invented. The form below always works by hand.
 */
export function IntakeBox({
  onPrefill,
}: {
  onPrefill: (values: IntakePrefill) => void;
  occasion?: string;
}) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  function runIntake() {
    // Placeholder intake: recognise nothing automatically, say so, keep the user in control.
    setStatus(
      'Automatic reading is not connected yet. Fill the form below — it takes under a minute.',
    );
    onPrefill({});
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
        <button type="button" onClick={runIntake} disabled={text.trim().length === 0}>
          Fill form from description
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
