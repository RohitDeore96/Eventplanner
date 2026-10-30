import { usePlan } from '../../state/store';
import type { ActivityEntry } from '../../state/activity';

const KIND_LABEL: Record<ActivityEntry['kind'], string> = {
  single: 'change',
  batch: 'batch',
  patch: 'AI patch',
};

function timeOf(atISO: string): string {
  const date = new Date(atISO);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * X9 activity log: every entry is one undo step — manual changes, scenario batches and
 * approved AI patches. Undo strikes the newest live entry out; Redo restores it. The log
 * is session state, exactly like the undo stack it mirrors.
 */
export function ActivityView(): React.ReactNode {
  const store = usePlan();
  const log = store.state.log;
  const entries = [...log].reverse(); // newest first

  return (
    <section className="card" aria-labelledby="activity-title">
      <h2 id="activity-title">Activity</h2>
      <p className="muted">
        Every change lands here as one undo step. Undo strikes an entry out; Redo puts it back. The
        log covers this session — like the undo stack itself — and starts fresh after a reload.
      </p>
      {entries.length === 0 ? (
        <p className="muted">No changes yet in this session.</p>
      ) : (
        <ol className="activity-list">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={entry.reverted ? 'activity-entry reverted' : 'activity-entry'}
            >
              <span className="activity-time">{timeOf(entry.atISO)}</span>{' '}
              <span className="activity-label">{entry.label}</span>{' '}
              <span className="muted">({KIND_LABEL[entry.kind]})</span>
              {entry.reverted && <span className="badge">undone</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
