import type { PlanAction } from '../../../engine/actions';
import type { Plan, RunSheetEntry } from '../../../engine/types';
import { text } from '../form';

/** The editing state of one run-sheet row: the full-width form inside a single cell. */
export function RunSheetEditRow({
  plan,
  entry,
  onApply,
  onDone,
}: {
  plan: Plan;
  entry: RunSheetEntry;
  onApply: (action: PlanAction, successMessage: string) => void;
  onDone: () => void;
}) {
  return (
    <tr>
      <td colSpan={6}>
        <form
          className="row"
          aria-label={`Edit ${entry.title}`}
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const ownerValue = text(data, 'owner');
            onApply(
              {
                type: 'runsheet/update',
                id: entry.id,
                title: text(data, 'title'),
                dateISO: text(data, 'date'),
                startTime: text(data, 'start'),
                endTime: text(data, 'end'),
                ownerId: ownerValue.length === 0 ? null : ownerValue,
                location: text(data, 'location'),
                note: text(data, 'note'),
              },
              'Activity updated.',
            );
            if (plan.runSheet.some((e) => e.id === entry.id)) onDone();
          }}
        >
          <div>
            <label htmlFor={`${entry.id}-title`}>Activity</label>
            <input
              id={`${entry.id}-title`}
              name="title"
              defaultValue={entry.title}
              required
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor={`${entry.id}-date`}>Date</label>
            <input
              id={`${entry.id}-date`}
              name="date"
              type="date"
              defaultValue={entry.dateISO}
              required
            />
          </div>
          <div>
            <label htmlFor={`${entry.id}-start`}>Start</label>
            <input
              id={`${entry.id}-start`}
              name="start"
              type="time"
              defaultValue={entry.startTime}
              required
            />
          </div>
          <div>
            <label htmlFor={`${entry.id}-end`}>End</label>
            <input
              id={`${entry.id}-end`}
              name="end"
              type="time"
              defaultValue={entry.endTime}
              required
            />
          </div>
          <div>
            <label htmlFor={`${entry.id}-owner`}>Responsible</label>
            <select id={`${entry.id}-owner`} name="owner" defaultValue={entry.ownerId ?? ''}>
              <option value="">The family</option>
              {plan.vendors
                .filter((v) => v.status !== 'cancelled')
                .map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${entry.id}-location`}>Where</label>
            <input
              id={`${entry.id}-location`}
              name="location"
              defaultValue={entry.location}
              maxLength={120}
            />
          </div>
          <div>
            <label htmlFor={`${entry.id}-note`}>Notes</label>
            <input id={`${entry.id}-note`} name="note" defaultValue={entry.note} maxLength={500} />
          </div>
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
