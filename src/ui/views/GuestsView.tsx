import { useMemo, useState } from 'react';
import { dietaryCounts } from '../../engine/guests';
import { summarize } from '../../engine/summary';
import type { DietaryTag, Plan, Rsvp } from '../../engine/types';
import { DIETARY_TAGS } from '../../engine/enums';
import { money } from '../../lib/format';
import { usePlan } from '../../state/store';
import { text } from './form';

const RSVP_OPTIONS: readonly { readonly value: Rsvp; readonly label: string }[] = [
  { value: 'yes', label: 'Coming' },
  { value: 'no', label: 'Not coming' },
  { value: 'pending', label: 'Waiting for reply' },
];

/** Human labels for the engine's dietary tags; shown as text, never colour alone. */
const DIETARY_LABELS: Record<DietaryTag, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  jain: 'Jain',
  no_onion_garlic: 'No onion & garlic',
  gluten_free: 'Gluten-free',
  dairy_free: 'Dairy-free',
  nut_allergy: 'Nut allergy',
  halal: 'Halal',
  kosher: 'Kosher',
  other: 'Other restrictions',
};

const ALLERGY_TAGS: readonly DietaryTag[] = ['nut_allergy', 'gluten_free', 'dairy_free'];

/** Shared checkbox group for dietary needs (multiple allowed per guest). */
function DietaryPicker({
  guestId,
  selected,
  legend,
}: {
  guestId: string;
  selected: readonly DietaryTag[];
  legend: string;
}) {
  return (
    <fieldset className="dietary-picker">
      <legend>{legend}</legend>
      {DIETARY_TAGS.map((tag) => (
        <label key={tag} className="check">
          <input
            type="checkbox"
            name={`${guestId}-dietary`}
            value={tag}
            defaultChecked={selected.includes(tag)}
          />{' '}
          {DIETARY_LABELS[tag]}
        </label>
      ))}
    </fieldset>
  );
}

function readDietary(formData: FormData, guestId: string): DietaryTag[] {
  return formData.getAll(`${guestId}-dietary`).map(String) as DietaryTag[];
}

/**
 * Guests: RSVPs, plus-ones and dietary needs, feeding the catering requirement.
 * Full CRUD with search and filters; every change goes through the plan reducer,
 * so dietary preferences survive reloads and are one undo step.
 */
export function GuestsView({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = useMemo(() => new Date().toLocaleDateString('sv-SE'), []);
  const summary = useMemo(() => summarize(plan, today), [plan, today]);
  const catering = summary.catering;
  const dietaryAll = useMemo(() => dietaryCounts(plan.guests), [plan.guests]);
  const dietaryShown = Object.entries(dietaryAll).filter(([, count]) => count > 0);
  const allergyCount = plan.guests.filter(
    (guest) => guest.rsvp !== 'no' && guest.dietary.some((tag) => ALLERGY_TAGS.includes(tag)),
  ).length;

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
  const confirmedGuests = plan.guests.filter((guest) => guest.rsvp === 'yes').length;
  const pendingGuests = plan.guests.filter((guest) => guest.rsvp === 'pending').length;
  const declinedGuests = plan.guests.filter((guest) => guest.rsvp === 'no').length;

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
        <p className="muted">
          {plan.guests.length} invited · {confirmedGuests} confirmed · {pendingGuests} waiting for
          reply · {declinedGuests} declined
        </p>
        {dietaryShown.length > 0 && (
          <p className="muted">
            Dietary needs among confirmed guests (
            {dietaryShown
              .map(([tag, count]) => `${DIETARY_LABELS[tag as DietaryTag]} ×${count}`)
              .join(', ')}
            ). Plus-ones' needs are unknown — confirm them separately.
          </p>
        )}
        {allergyCount > 0 && (
          <div className="alert">
            <strong>
              <span aria-hidden="true">⚠️</span> {allergyCount} guest
              {allergyCount === 1 ? ' has' : 's have'} allergy-related needs
            </strong>{' '}
            (nut allergy, gluten-free or dairy-free). Tell the caterer explicitly.
          </div>
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
          <table>
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
                  <tr key={guest.id}>
                    <td colSpan={6}>
                      <form
                        className="row"
                        aria-label={`Edit ${guest.name}`}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          const plusOnes = Number(data.get('plusOnes') ?? 0);
                          const outcome = store.apply({
                            type: 'guest/update',
                            id: guest.id,
                            name: text(data, 'name'),
                            rsvp: text(data, 'rsvp') as Rsvp,
                            plusOnes: Number.isInteger(plusOnes) ? plusOnes : 0,
                            dietary: readDietary(data, guest.id),
                            group: text(data, 'group'),
                          });
                          if (outcome.ok) setEditingId(null);
                        }}
                      >
                        <div>
                          <label htmlFor={`${guest.id}-name`}>Name</label>
                          <input
                            id={`${guest.id}-name`}
                            name="name"
                            defaultValue={guest.name}
                            required
                            maxLength={80}
                          />
                        </div>
                        <div>
                          <label htmlFor={`${guest.id}-rsvp`}>RSVP</label>
                          <select id={`${guest.id}-rsvp`} name="rsvp" defaultValue={guest.rsvp}>
                            {RSVP_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`${guest.id}-plus`}>Plus-ones</label>
                          <input
                            id={`${guest.id}-plus`}
                            name="plusOnes"
                            type="number"
                            min={0}
                            max={10}
                            defaultValue={guest.plusOnes}
                          />
                        </div>
                        <div>
                          <label htmlFor={`${guest.id}-group`}>Group</label>
                          <input
                            id={`${guest.id}-group`}
                            name="group"
                            defaultValue={guest.group}
                            maxLength={80}
                          />
                        </div>
                        <DietaryPicker
                          guestId={guest.id}
                          selected={guest.dietary}
                          legend="Dietary needs (any that apply)"
                        />
                        <button type="submit" className="primary">
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                          }}
                        >
                          Cancel
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : (
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
                            rsvp: event.target.value as Rsvp,
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
                    <td>
                      {guest.dietary.length === 0
                        ? '—'
                        : guest.dietary.map((tag) => DIETARY_LABELS[tag]).join(', ')}
                    </td>
                    <td>{guest.group || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="subtle"
                        onClick={() => {
                          setEditingId(guest.id);
                        }}
                      >
                        Edit
                      </button>{' '}
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
                ),
              )}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
