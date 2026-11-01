import { useMemo, useState } from 'react';
import type { PlanAction } from '../../engine/actions';
import { localToday } from '../../lib/format';
import { orderedRunSheet, runSheetConflicts, runSheetSpan } from '../../engine/runsheet';
import type { Plan } from '../../engine/types';
import { usePlan } from '../../state/store';
import { AddActivityForm } from './runsheet/AddActivityForm';
import { RunSheetRow } from './runsheet/RunSheetRow';

/**
 * Event-day run sheet (M7): the family's schedule for the day(s) of the event itself.
 * Deliberately presented apart from planning tasks and payment due dates; conflicts are
 * shown for deliberate correction, never silently resolved. Print gives a clean paper copy.
 * Row editing lives in `runsheet/RunSheetRow.tsx`, adding in `runsheet/AddActivityForm.tsx`.
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

  return (
    <>
      <section className="card print-sheet" aria-labelledby="runsheet-title">
        <div className="row no-print">
          <h2 id="runsheet-title">Event-day run sheet</h2>
          <button
            type="button"
            onClick={() => {
              window.print();
            }}
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

      <AddActivityForm plan={plan} onApply={apply} />
    </>
  );
}

function nameOf(plan: Plan, entryId: string): string {
  return plan.runSheet.find((entry) => entry.id === entryId)?.title ?? 'an activity';
}
