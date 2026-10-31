import { useMemo, useState } from 'react';
import type { PlanAction } from '../../engine/actions';
import { localToday } from '../../lib/format';
import { orderedRunSheet, runSheetConflicts, runSheetSpan } from '../../engine/runsheet';
import type { Plan, RunSheetEntry } from '../../engine/types';
import { usePlan } from '../../state/store';
import { text } from './form';

/**
 * Event-day run sheet (M7): the family's schedule for the day(s) of the event itself.
 * Deliberately presented apart from planning tasks and payment due dates; conflicts are
 * shown for deliberate correction, never silently resolved. Print gives a clean paper copy.
 */
export function RunSheetView({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = useMemo(() => localToday(), []);
  const [notice, setNotice] = useState<string | null>(null);
  const conflicts = useMemo(() => runSheetConflicts(plan.runSheet), [plan.runSheet]);
  const ordered = useMemo(() => orderedRunSheet(plan.runSheet), [plan.runSheet]);
  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    for (const conflict of conflicts) {
      ids.add(conflict.firstId);
      ids.add(conflict.secondId);
    }
    return ids;
  }, [conflicts]);

  function apply(action: PlanAction, successMessage: string): void {
    const outcome = store.apply(action);
    setNotice(outcome.ok ? successMessage : (outcome.message ?? 'That change was rejected.'));
  }

  function printSheet(): void {
    window.print();
  }

  return (
    <>
      <section className="card print-sheet" aria-labelledby="runsheet-title">
        <div className="row no-print">
          <h2 id="runsheet-title">Event-day run sheet</h2>
          <button
            type="button"
            onClick={printSheet}
            style={{ marginLeft: 'auto' }}
            disabled={plan.runSheet.length === 0}
          >
            Print the run sheet
          </button>
        </div>
        <p className="muted no-print">
          The schedule for the event day(s) itself — who does what, where and when. Planning tasks
          live in the Timeline tab; vendor payment dates live in Payments.
          {plan.runSheet.length > 0 &&
            ` Scheduled span: ${Math.floor(runSheetSpan(plan.runSheet) / 60)} h ${runSheetSpan(plan.runSheet) % 60} min.`}
        </p>
        <div className="print-only">
          <h1>{plan.name} — run sheet</h1>
          <p>
            Event date: {plan.dateISO} · {plan.guestTarget} guests · printed {today}
          </p>
        </div>
        {conflicts.length > 0 && (
          <div className="alert" role="status">
            <strong>
              <span aria-hidden="true">⚠️</span> {conflicts.length} scheduling conflict
              {conflicts.length === 1 ? '' : 's'} to review
            </strong>
            <ul>
              {conflicts.map((conflict) => (
                <li key={`${conflict.firstId}-${conflict.secondId}`}>
                  {nameOf(plan, conflict.firstId)} overlaps {nameOf(plan, conflict.secondId)} on{' '}
                  {conflict.dateISO}.
                </li>
              ))}
            </ul>
          </div>
        )}
        {plan.runSheet.length === 0 ? (
          <p className="muted">
            No activities yet. Add venue setup, catering arrival, the ceremony — everything the day
            needs, in order.
          </p>
        ) : (
          <table tabIndex={0}>
            <caption className="visually-hidden">
              Event-day activities with times, owner, place and status
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Activity</th>
                <th scope="col">Owner</th>
                <th scope="col">Where</th>
                <th scope="col">Status</th>
                <th scope="col" className="no-print">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((entry) => (
                <RunSheetRow
                  key={entry.id}
                  plan={plan}
                  entry={entry}
                  hasConflict={conflictIds.has(entry.id)}
                  onApply={apply}
                />
              ))}
            </tbody>
          </table>
        )}
        {notice !== null && (
          <p className="muted no-print" role="status">
            {notice}
          </p>
        )}
      </section>

      <section className="card no-print" aria-labelledby="addentry-title">
        <h2 id="addentry-title">Add an activity</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const owner = text(data, 'owner');
            apply(
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
    </>
  );
}

function nameOf(plan: Plan, entryId: string): string {
  return plan.runSheet.find((entry) => entry.id === entryId)?.title ?? 'an activity';
}

function RunSheetRow({
  plan,
  entry,
  hasConflict,
  onApply,
}: {
  plan: Plan;
  entry: RunSheetEntry;
  hasConflict: boolean;
  onApply: (action: PlanAction, successMessage: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const owner =
    entry.ownerId === null ? null : (plan.vendors.find((v) => v.id === entry.ownerId) ?? null);
  const index = plan.runSheet.findIndex((e) => e.id === entry.id);

  if (editing) {
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
              if (plan.runSheet.some((e) => e.id === entry.id)) setEditing(false);
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
              <input
                id={`${entry.id}-note`}
                name="note"
                defaultValue={entry.note}
                maxLength={500}
              />
            </div>
            <button type="submit" className="primary">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <th scope="row">
        {entry.startTime}–{entry.endTime}
        <div className="muted">{entry.dateISO}</div>
      </th>
      <td>
        <strong>{entry.title}</strong>
        {entry.note.length > 0 && <div className="muted">{entry.note}</div>}
      </td>
      <td>{owner?.name ?? 'The family'}</td>
      <td>{entry.location || '—'}</td>
      <td>
        {entry.done ? (
          <span className="badge success">
            <span aria-hidden="true">✓</span> Done
          </span>
        ) : hasConflict ? (
          <span className="badge error">
            <span aria-hidden="true">!</span> Conflict
          </span>
        ) : (
          <span className="badge">
            <span aria-hidden="true">•</span> Planned
          </span>
        )}
      </td>
      <td className="no-print">
        <div className="row">
          <button
            type="button"
            onClick={() => {
              onApply(
                { type: 'runsheet/toggle', id: entry.id, done: !entry.done },
                entry.done ? 'Marked not done.' : 'Marked done.',
              );
            }}
          >
            {entry.done ? 'Undo' : 'Done'}
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => {
              setEditing(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="subtle"
            aria-label={`Move ${entry.title} earlier`}
            disabled={index <= 0}
            onClick={() => {
              onApply(
                { type: 'runsheet/reorder', id: entry.id, toIndex: Math.max(0, index - 1) },
                'Moved up.',
              );
            }}
          >
            ↑
          </button>
          <button
            type="button"
            className="subtle"
            aria-label={`Move ${entry.title} later`}
            disabled={index < 0 || index >= plan.runSheet.length - 1}
            onClick={() => {
              onApply(
                {
                  type: 'runsheet/reorder',
                  id: entry.id,
                  toIndex: Math.min(plan.runSheet.length - 1, index + 1),
                },
                'Moved down.',
              );
            }}
          >
            ↓
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onApply({ type: 'runsheet/delete', id: entry.id }, 'Activity removed.');
                }}
              >
                Really remove
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="subtle"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Remove
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
