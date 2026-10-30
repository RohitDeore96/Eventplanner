import { useMemo } from 'react';
import { summarize } from '../../engine/summary';
import type { Plan } from '../../engine/types';
import { money } from '../../lib/format';
import { usePlan } from '../../state/store';
import { text } from './form';

const RSVP_OPTIONS = [
  { value: 'yes', label: 'Coming' },
  { value: 'no', label: 'Not coming' },
  { value: 'pending', label: 'Waiting for reply' },
] as const;

/** Guests: RSVPs, plus-ones and dietary needs, feeding the catering requirement. */
export function GuestsView({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = useMemo(() => new Date().toLocaleDateString('sv-SE'), []);
  const summary = useMemo(() => summarize(plan, today), [plan, today]);
  const catering = summary.catering;
  const dietary = Object.entries(catering.dietary).filter(([, count]) => count > 0);

  return (
    <>
      <section className="card" aria-labelledby="catering-title">
        <h2 id="catering-title">Catering requirement</h2>
        <p>
          <strong>{catering.headcount}</strong> people to cater for (
          {catering.basis === 'confirmed'
            ? 'from confirmed RSVPs'
            : 'from your target — no RSVPs yet'}
          ).
          {catering.perHeadMinor !== null && (
            <span> Per-head budget: {money(catering.perHeadMinor, plan)}.</span>
          )}
        </p>
        {dietary.length > 0 && (
          <p className="muted">
            Dietary needs among confirmed guests:{' '}
            {dietary.map(([tag, count]) => `${tag.replace('_', ' ')} ×${count}`).join(', ')}.
          </p>
        )}
        {summary.warnings.some((w) => w.code === 'CONFIRMED_ABOVE_TARGET') && (
          <div className="alert">
            <strong>
              <span aria-hidden="true">⚠️</span> Warning: more guests have confirmed than your
              target.
            </strong>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="addguest-title">
        <h2 id="addguest-title">Add a guest</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const plusOnes = Number(data.get('plusOnes') ?? 0);
            const outcome = store.apply({
              type: 'guest/add',
              id: `g-${Date.now().toString(36)}`,
              name: text(data, 'name'),
              rsvp: 'pending',
              plusOnes: Number.isInteger(plusOnes) ? plusOnes : 0,
              dietary: [],
              group: text(data, 'group'),
            });
            if (outcome.ok) form.reset();
          }}
        >
          <div>
            <label htmlFor="g-name">Name</label>
            <input id="g-name" name="name" required maxLength={80} />
          </div>
          <div>
            <label htmlFor="g-plus">Plus-ones</label>
            <input id="g-plus" name="plusOnes" type="number" min={0} max={10} defaultValue={0} />
          </div>
          <div>
            <label htmlFor="g-group">Group (family, friends…)</label>
            <input id="g-group" name="group" maxLength={80} />
          </div>
          <button type="submit" className="primary">
            Add guest
          </button>
        </form>
        {store.state.lastError !== null && (
          <p className="field-error" role="alert">
            {store.state.lastError.message}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="list-title">
        <h2 id="list-title">Guest list ({plan.guests.length})</h2>
        {plan.guests.length === 0 ? (
          <p className="muted">No guests yet. Add the people you want there.</p>
        ) : (
          <table>
            <caption className="visually-hidden">Guests with RSVP, plus-ones and group</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">RSVP</th>
                <th scope="col">Plus-ones</th>
                <th scope="col">Group</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.guests.map((guest) => (
                <tr key={guest.id}>
                  <th scope="row">{guest.name}</th>
                  <td>
                    <select
                      aria-label={`RSVP for ${guest.name}`}
                      value={guest.rsvp}
                      onChange={(event) =>
                        store.apply({
                          type: 'guest/update',
                          id: guest.id,
                          rsvp: event.target.value as 'yes' | 'no' | 'pending',
                        })
                      }
                    >
                      {RSVP_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{guest.plusOnes}</td>
                  <td>{guest.group || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="subtle"
                      onClick={() => {
                        store.apply({ type: 'guest/delete', id: guest.id });
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
