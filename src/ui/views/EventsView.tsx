import { useState } from 'react';
import { daysBetween } from '../../engine/dates';
import { budgetTotals } from '../../engine/budget';
import type { Plan } from '../../engine/types';
import { localToday, money } from '../../lib/format';
import { OCCASION_OPTIONS } from './SetupView';

/**
 * R8 multi-event manager: every saved event at a glance, with the active one marked.
 * Switching replaces the working plan; deletion needs a second, explicit confirmation —
 * a family's wedding plan must never vanish on one misclick.
 */

function occasionLabel(plan: Plan): string {
  return OCCASION_OPTIONS.find((o) => o.value === plan.occasion)?.label ?? plan.occasion;
}

function Row({
  plan,
  active,
  onOpen,
  onDelete,
}: {
  plan: Plan;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}): React.ReactNode {
  const [confirming, setConfirming] = useState(false);
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

  return (
    <li className="event-row">
      <div className="event-main">
        <strong>{plan.name}</strong> {active && <span className="badge success">active</span>}
        <div className="muted">
          {occasionLabel(plan)} · {plan.dateISO}
          {daysLabel} · {plan.guestTarget} guests · budget {money(totals.budget, plan)}
        </div>
      </div>
      <div className="row">
        {!active && (
          <button type="button" onClick={onOpen}>
            Open
          </button>
        )}
        {confirming ? (
          <>
            <button type="button" className="danger" onClick={onDelete}>
              Really delete “{plan.name}”
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
            }}
          >
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
  onOpen,
  onDelete,
  onNew,
  canCreate,
}: {
  events: readonly Plan[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  canCreate: boolean;
}): React.ReactNode {
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
      {events.length === 0 ? (
        <p className="muted">No events yet — create your first one below.</p>
      ) : (
        <ul className="event-list">
          {events.map((plan) => (
            <Row
              key={plan.id}
              plan={plan}
              active={plan.id === activeId}
              onOpen={() => {
                onOpen(plan.id);
              }}
              onDelete={() => {
                onDelete(plan.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
