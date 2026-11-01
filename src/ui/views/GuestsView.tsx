import { useMemo, useState } from 'react';
import { summarize } from '../../engine/summary';
import type { Plan, Rsvp } from '../../engine/types';
import { usePlan } from '../../state/store';
import { text } from './form';
import { CateringSummary } from './guests/CateringSummary';
import { GuestEditRow, GuestRow } from './guests/GuestRows';
import { DietaryPicker, RSVP_OPTIONS, readDietary } from './guests/shared';

/**
 * Guests: RSVPs, plus-ones and dietary needs, feeding the catering requirement.
 * Full CRUD with search and filters; every change goes through the plan reducer,
 * so dietary preferences survive reloads and are one undo step.
 */
export function GuestsView({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = useMemo(() => new Date().toLocaleDateString('sv-SE'), []);
  const summary = useMemo(() => summarize(plan, today), [plan, today]);

  const [query, setQuery] = useState('');
  const [rsvpFilter, setRsvpFilter] = useState<'all' | Rsvp>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);

  const groups = useMemo(
    () => [...new Set(plan.guests.map((guest) => guest.group).filter((g) => g.length > 0))].sort(),
    [plan.guests],
  );
  const visible = plan.guests.filter((guest) => {
    const matchesQuery =
      query.trim().length === 0 ||
      guest.name.toLowerCase().includes(query.trim().toLowerCase()) ||
      guest.group.toLowerCase().includes(query.trim().toLowerCase());
    const matchesRsvp = rsvpFilter === 'all' || guest.rsvp === rsvpFilter;
    const matchesGroup = groupFilter === 'all' || guest.group === groupFilter;
    return matchesQuery && matchesRsvp && matchesGroup;
  });

  return (
    <>
      <CateringSummary plan={plan} summary={summary} />

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
              dietary: readDietary(data, 'new'),
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
          <DietaryPicker guestId="new" selected={[]} legend="Dietary needs (any that apply)" />
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
        <div className="row">
          <div>
            <label htmlFor="g-search">Search guests</label>
            <input
              id="g-search"
              type="search"
              value={query}
              placeholder="Name or group"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <div>
            <label htmlFor="g-rsvp-filter">RSVP</label>
            <select
              id="g-rsvp-filter"
              value={rsvpFilter}
              onChange={(event) => {
                setRsvpFilter(event.target.value as 'all' | Rsvp);
              }}
            >
              <option value="all">All replies</option>
              {RSVP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {groups.length > 0 && (
            <div>
              <label htmlFor="g-group-filter">Group</label>
              <select
                id="g-group-filter"
                value={groupFilter}
                onChange={(event) => {
                  setGroupFilter(event.target.value);
                }}
              >
                <option value="all">All groups</option>
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {plan.guests.length === 0 ? (
          <p className="muted">No guests yet. Add the people you want there.</p>
        ) : visible.length === 0 ? (
          <p className="muted">No guests match these filters.</p>
        ) : (
          <table tabIndex={0}>
            <caption className="visually-hidden">
              Guests with RSVP, plus-ones, dietary needs and group
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">RSVP</th>
                <th scope="col">Plus-ones</th>
                <th scope="col">Dietary needs</th>
                <th scope="col">Group</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((guest) =>
                editingId === guest.id ? (
                  <GuestEditRow
                    key={guest.id}
                    guest={guest}
                    onDone={() => {
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <GuestRow
                    key={guest.id}
                    guest={guest}
                    onEdit={() => {
                      setEditingId(guest.id);
                    }}
                  />
                ),
              )}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
