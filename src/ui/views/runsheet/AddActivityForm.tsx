import type { PlanAction } from '../../../engine/actions';
import type { Plan } from '../../../engine/types';
import { usePlan } from '../../../state/store';
import { text } from '../form';

/**
 * The "Add an activity" card of the run sheet. It reads `state.lastError` from the store
 * directly (synchronously, right after the action is applied) so the form only resets
 * when the add really landed — exactly as before the extraction.
 */
export function AddActivityForm({
  plan,
  onApply,
}: {
  plan: Plan;
  onApply: (action: PlanAction, successMessage: string) => void;
}) {
  const store = usePlan();
  return (
    <section className="card no-print" aria-labelledby="addentry-title">
      <h2 id="addentry-title">Add an activity</h2>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const owner = text(data, 'owner');
          onApply(
            {
              type: 'runsheet/add',
              id: `r-${Date.now().toString(36)}`,
              title: text(data, 'title'),
              dateISO: text(data, 'date'),
              startTime: text(data, 'start'),
              endTime: text(data, 'end'),
              ownerId: owner.length === 0 ? null : owner,
              location: text(data, 'location'),
              note: text(data, 'note'),
            },
            'Activity added to the run sheet.',
          );
          if (store.state.lastError === null) form.reset();
        }}
      >
        <div>
          <label htmlFor="rs-title">Activity</label>
          <input id="rs-title" name="title" required maxLength={80} />
        </div>
        <div>
          <label htmlFor="rs-date">Date</label>
          <input id="rs-date" name="date" type="date" required defaultValue={plan.dateISO} />
        </div>
        <div>
          <label htmlFor="rs-start">Start</label>
          <input
            id="rs-start"
            name="start"
            type="time"
            required
            defaultValue="09:00"
            step={300}
          />
        </div>
        <div>
          <label htmlFor="rs-end">End</label>
          <input id="rs-end" name="end" type="time" required defaultValue="10:00" step={300} />
        </div>
        <div>
          <label htmlFor="rs-owner">Responsible (optional)</label>
          <select id="rs-owner" name="owner">
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
          <label htmlFor="rs-location">Where (optional)</label>
          <input id="rs-location" name="location" maxLength={120} />
        </div>
        <div>
          <label htmlFor="rs-note">Notes (optional)</label>
          <input id="rs-note" name="note" maxLength={500} />
        </div>
        <button type="submit" className="primary">
          Add activity
        </button>
      </form>
      {store.state.lastError !== null && (
        <p className="field-error" role="alert">
          {store.state.lastError.message}
        </p>
      )}
    </section>
  );
}
