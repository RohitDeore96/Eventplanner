import { exportTextFile } from '../../lib/export';
import { clearSavedPlan, type RecoveryInfo } from '../../state/persistence';

const RECOVERY_REASONS: Record<RecoveryInfo['reason'], string> = {
  unavailable:
    'Saved events could not be read because this browser’s storage is unavailable (blocked or private mode).',
  unreadable: 'The saved events in this browser are not readable (the data is corrupted).',
  too_large: 'The saved events in this browser are too large to load.',
  newer_version:
    'The saved events were written by a newer version of Utsav, so they were not loaded here.',
};

/**
 * Recovery path for untrusted stored data: never loaded into the app, never deleted
 * silently. The family can keep an exportable copy of exactly what was stored, then
 * start fresh when ready. When storage itself refused to be read there is nothing to
 * export, so only the copy-less "start fresh" path is offered.
 */
export function RecoveryNotice({ recovery }: { recovery: RecoveryInfo }): React.ReactNode {
  const hasCopy = recovery.raw.length > 0;
  return (
    <section className="card" role="alert" aria-labelledby="recovery-title">
      <h2 id="recovery-title">Your saved plan needs attention</h2>
      <p className="muted">
        {RECOVERY_REASONS[recovery.reason]} Nothing in this browser was changed.
        {hasCopy
          ? ' Download a copy of the stored data if you want to keep it, then start fresh.'
          : ' Start fresh to continue.'}
      </p>
      <div className="row">
        {hasCopy && (
          <button
            type="button"
            onClick={() => {
              exportTextFile('utsav-recovered-plan.json', recovery.raw);
            }}
          >
            Download a copy
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            clearSavedPlan();
            window.location.reload();
          }}
        >
          Start fresh
        </button>
      </div>
    </section>
  );
}
