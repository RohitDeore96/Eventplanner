import { useMemo, useState } from 'react';
import type { PlanAction } from '../../engine/actions';
import { buildIcs } from '../../engine/ics';
import { buildTimeline } from '../../engine/timeline';
import type { Plan } from '../../engine/types';
import { localToday } from '../../lib/format';
import { usePlan } from '../../state/store';
import { text } from './form';

/** Timeline: tasks grouped by due date, overdue flags, delay with ripple reasons, .ics export. */
export function TimelineView({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = useMemo(() => localToday(), []);
  const timeline = useMemo(() => buildTimeline(plan, today), [plan, today]);
  const [reasons, setReasons] = useState<string[] | null>(null);

  function downloadIcs() {
    const ics = buildIcs(`${plan.name} — Utsav timeline`, timeline, today);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'utsav-timeline.ics';
    link.click();
    URL.revokeObjectURL(url);
  }

  function delay(id: string, days: number) {
    const action: PlanAction = { type: 'task/delay', id, days };
    store.apply(action);
    setReasons(store.state.lastError === null ? null : [store.state.lastError.message]);
  }

  return (
    <>
      <section className="card" aria-labelledby="tl-title">
        <div className="row">
          <h2 id="tl-title">Timeline ({timeline.length} tasks)</h2>
          <button type="button" onClick={downloadIcs} style={{ marginLeft: 'auto' }}>
            Add timeline to calendar (.ics)
          </button>
        </div>
        <table>
          <caption className="visually-hidden">Tasks with due dates, status and actions</caption>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((item) => (
              <tr key={item.id}>
                <th scope="row">
                  {item.title}
                  {item.kind === 'payment' && (item.outstandingMinor ?? 0) > 0 && (
                    <div className="muted">Partly paid — balance due.</div>
                  )}
                </th>
                <td>{item.dueISO}</td>
                <td>
                  {item.done ? (
                    <span className="badge success">
                      <span aria-hidden="true">✓</span> Done
                    </span>
                  ) : item.overdue ? (
                    <span className="badge error">
                      <span aria-hidden="true">⛔</span> Overdue
                    </span>
                  ) : (
                    <span className="badge">
                      <span aria-hidden="true">•</span> Upcoming
                    </span>
                  )}
                </td>
                <td>
                  <div className="row">
                    {item.kind === 'task' && !item.done && (
                      <button
                        type="button"
                        onClick={() => {
                          store.apply({ type: 'task/update', id: item.id, done: true });
                        }}
                      >
                        Done
                      </button>
                    )}
                    {item.kind === 'task' && !item.done && (
                      <button
                        type="button"
                        className="subtle"
                        onClick={() => {
                          delay(item.id, 7);
                        }}
                      >
                        Delay 7d
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          Bars: <span className="badge success">✓ Done</span>{' '}
          <span className="badge error">⛔ Overdue</span>{' '}
          <span className="badge warn">! Short notice</span> — status is always text plus icon,
          never colour alone.
        </p>
        {reasons !== null && (
          <div role="status" aria-live="polite">
            {reasons.map((reason) => (
              <p key={reason} className="muted">
                {reason}
              </p>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="addtask-title">
        <h2 id="addtask-title">Add your own task</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const outcome = store.apply({
              type: 'task/add',
              id: `tk-${Date.now().toString(36)}`,
              title: text(data, 'title'),
              dueISO: text(data, 'due'),
              dependsOn: [],
              assignee: null,
            });
            if (outcome.ok) form.reset();
          }}
        >
          <div>
            <label htmlFor="tk-title">What needs doing</label>
            <input id="tk-title" name="title" required maxLength={80} />
          </div>
          <div>
            <label htmlFor="tk-due">Due date</label>
            <input id="tk-due" name="due" type="date" required />
          </div>
          <button type="submit" className="primary">
            Add task
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
