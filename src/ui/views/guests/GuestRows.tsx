import type { Guest } from '../../../engine/types';
import { RSVPS } from '../../../engine/enums';
import { usePlan } from '../../../state/store';
import { parseEnum, text } from '../form';
import { DietaryPicker, DIETARY_LABELS, RSVP_OPTIONS, readDietary } from './shared';

/** The editing row: name, RSVP, plus-ones, group and dietary needs in one form. */
export function GuestEditRow({ guest, onDone }: { guest: Guest; onDone: () => void }) {
  const store = usePlan();
  return (
    <tr>
      <td colSpan={6}>
        <form
          className="row"
          aria-label={`Edit ${guest.name}`}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const plusOnes = Number(data.get('plusOnes') ?? 0);
            // Proven before it is typed: the select is user input. An invalid value
            // keeps the form open exactly as the engine's own rejection did.
            const rsvp = parseEnum(text(data, 'rsvp'), RSVPS);
            if (rsvp === null) return;
            const outcome = store.apply({
              type: 'guest/update',
              id: guest.id,
              name: text(data, 'name'),
              rsvp,
              plusOnes: Number.isInteger(plusOnes) ? plusOnes : 0,
              dietary: readDietary(data, guest.id),
              group: text(data, 'group'),
            });
            if (outcome.ok) onDone();
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
              onDone();
            }}
          >
            Cancel
          </button>
        </form>
      </td>
    </tr>
  );
}

/** One guest line: inline RSVP change, dietary summary, edit and remove. */
export function GuestRow({ guest, onEdit }: { guest: Guest; onEdit: () => void }) {
  const store = usePlan();
  return (
    <tr>
      <th scope="row">{guest.name}</th>
      <td>
        <select
          aria-label={`RSVP for ${guest.name}`}
          value={guest.rsvp}
          onChange={(event) => {
            // Proven before it is typed: the select is user input; an invalid value
            // leaves the guest untouched exactly as the engine's rejection did.
            const rsvp = parseEnum(event.target.value, RSVPS);
            if (rsvp === null) return;
            store.apply({
              type: 'guest/update',
              id: guest.id,
              rsvp,
            });
          }}
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
            onEdit();
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
  );
}
