import { useState } from 'react';
import { daysBetween } from '../../engine/dates';
import { budgetTotals } from '../../engine/budget';
import type { Plan } from '../../engine/types';
import { localToday, money } from '../../lib/format';
import { OCCASION_OPTIONS } from './SetupView';

/**
 * R8/Phase-2 multi-event manager: every saved event at a glance, with the active one
 * marked. Duplicate copies an event with entirely fresh ids; archive sets it aside without
 * deleting anything; deletion needs a second, explicit confirmation — a family's wedding
 * plan must never vanish on one misclick.
 */

function occasionLabel(plan: Plan): string {
  return OCCASION_OPTIONS.find((o) => o.value === plan.occasion)?.label ?? plan.occasion;
}

function Row({
  plan,
  active,
  confirmingDelete,
  onAskDelete,
  onCancelDelete,
  onOpen,
  onDelete,
  onDuplicate,
  onArchive,
}: {
  plan: Plan;
  active: boolean;
  confirmingDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
}): React.ReactNode {
  const days = daysBetween(localToday(), plan.dateISO);
  const daysLabel =
    days === null
      ? ''
      : days === 0
        ? ' — today'
        : days > 0
          ? ` — in ${days} day(s)`
          : ` — ${Math.abs(days)} day(s) ago`;
  const totals = budgetTotals(plan);
  const progress = plan.tasks.length
    ? Math.round((plan.tasks.filter((t) => t.done).length / plan.tasks.length) * 100)
    : 100;

  return (
    <li className="event-row">
      <div className="event-main">
        <strong>{plan.name}</strong> {active && <span className="badge success">active</span>}
        <div className="muted">
          {occasionLabel(plan)} · {plan.dateISO}
          {daysLabel} · {plan.guestTarget} guests · budget {money(totals.budget, plan)} · {progress}
          % of tasks done
        </div>
      </div>
      <div className="row">
        {!active && (
          <button type="button" onClick={onOpen}>
            Open
          </button>
        )}
        <button type="button" onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="subtle" onClick={onArchive}>
          Archive
        </button>
        {confirmingDelete ? (
          <>
            <button type="button" className="danger" onClick={onDelete}>
              Really delete “{plan.name}” and all its data
            </button>
            <button type="button" onClick={onCancelDelete}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" onClick={onAskDelete}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

export function EventsView({
  events,
  activeId,
  archivedIds,
  onOpen,
  onDelete,
  onNew,
  onDuplicate,
  onArchive,
  onRestore,
  canCreate,
}: {
  events: readonly Plan[];
  activeId: string | null;
  archivedIds: readonly string[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  canCreate: boolean;
}): React.ReactNode {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const active = events.filter((p) => !archivedIds.includes(p.id));
  const archived = events.filter((p) => archivedIds.includes(p.id));
  return (
    <section className="card" aria-labelledby="events-title">
      <h2 id="events-title">All events</h2>
      <p className="muted">
        Every event saved in this browser, each with its own budget, guests, vendors and timeline.
        Open one to work on it — the others keep their data untouched.
      </p>
      <div className="row">
        <button type="button" className="primary" onClick={onNew} disabled={!canCreate}>
          New event
        </button>
        {!canCreate && (
          <span className="muted">This browser stores up to 12 events — delete one first.</span>
        )}
      </div>
      {active.length === 0 ? (
        <p className="muted">No events yet — create your first one below.</p>
      ) : (
        <ul className="event-list">
          {active.map((plan) => (
            <Row
              key={plan.id}
              plan={plan}
              active={plan.id === activeId}
              confirmingDelete={confirmingId === plan.id}
              onAskDelete={() => {
                setConfirmingId(plan.id);
              }}
              onCancelDelete={() => {
                setConfirmingId(null);
              }}
              onOpen={() => {
                onOpen(plan.id);
              }}
              onDelete={() => {
                setConfirmingId(null);
                onDelete(plan.id);
              }}
              onDuplicate={() => {
                onDuplicate(plan.id);
              }}
              onArchive={() => {
                onArchive(plan.id);
              }}
            />
          ))}
        </ul>
      )}
      <h3>Archived</h3>
      {archived.length === 0 ? (
        <p className="muted">
          Nothing archived. Archiving sets an event aside — it stays saved and restorable, and never
          appears in the working tabs.
        </p>
      ) : (
        <ul className="event-list">
          {archived.map((plan) => (
            <li className="event-row" key={plan.id}>
              <div className="event-main">
                <strong>{plan.name}</strong> <span className="badge">archived</span>
                <div className="muted">
                  {occasionLabel(plan)} · {plan.dateISO} · kept safe, not shown in the tabs
                </div>
              </div>
              <div className="row">
                <button
                  type="button"
                  onClick={() => {
                    onRestore(plan.id);
                  }}
                >
                  Restore
                </button>
                {confirmingId === plan.id ? (
                  <>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        onDelete(plan.id);
                      }}
                    >
                      Really delete “{plan.name}” and all its data
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingId(null);
                      }}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingId(plan.id);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
