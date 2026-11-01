import { useState } from 'react';
import type { PlanAction } from '../../../engine/actions';
import type { Plan, RunSheetEntry } from '../../../engine/types';
import { RunSheetEditRow } from './RunSheetEditRow';

function RunSheetStatusBadge({
  entry,
  hasConflict,
}: {
  entry: RunSheetEntry;
  hasConflict: boolean;
}) {
  return (
    <>
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
    </>
  );
}

/** One run-sheet row: display state, inline edit state and its row-level actions. */
export function RunSheetRow({
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
      <RunSheetEditRow
        plan={plan}
        entry={entry}
        onApply={onApply}
        onDone={() => {
          setEditing(false);
        }}
      />
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
        <RunSheetStatusBadge entry={entry} hasConflict={hasConflict} />
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
