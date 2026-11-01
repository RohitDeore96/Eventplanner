import { useState } from 'react';
import { exportTextFile } from '../../lib/export';
import { clearSavedPlan, type RecoveryInfo } from '../../state/persistence';
import { continueSessionWithoutStorage } from '../../state/sessionStore';

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
 * export, so the honest way forward is the explicit "continue for this session" action:
 * the app then runs on an in-memory store that dies with the tab — no claim that
 * anything was saved or cleared, and the real (unreadable) data stays untouched.
 */
export function RecoveryNotice({
  recovery,
  onSessionContinue,
}: {
  recovery: RecoveryInfo;
  onSessionContinue: () => void;
}): React.ReactNode {
  const hasCopy = recovery.raw.length > 0;
  // "Start fresh" is only a fresh start when the browser actually allowed the clear.
  // When it refuses (the same blocked storage that caused the recovery), saying nothing
  // and reloading would loop the user through this card forever — so the failure gets
  // its own truthful message and the session-only continuation becomes the way out.
  const [clearRefused, setClearRefused] = useState(false);
  const offerSession = recovery.reason === 'unavailable' || clearRefused;
  return (
    <section className="card" role="alert" aria-labelledby="recovery-title">
      <h2 id="recovery-title">Your saved plan needs attention</h2>
      <p className="muted">
        {RECOVERY_REASONS[recovery.reason]} Nothing in this browser was changed.
        {hasCopy
          ? ' Download a copy of the stored data if you want to keep it, then start fresh.'
          : offerSession
            ? ' Start fresh to clear it, or continue for this session — changes then last only until you close this tab.'
            : ' Start fresh to continue.'}
      </p>
      {clearRefused && (
        <p className="alert" role="status">
          <strong>
            <span aria-hidden="true">⚠️</span> The browser refused to clear the saved data, so
            nothing was deleted.
          </strong>{' '}
          Your saved events are untouched. You can continue for this session instead: what you do
          will last only until you close this tab.
        </p>
      )}
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
            if (clearSavedPlan()) {
              window.location.reload();
            } else {
              setClearRefused(true);
            }
          }}
        >
          Start fresh
        </button>
        {offerSession && (
          <button
            type="button"
            onClick={() => {
              continueSessionWithoutStorage();
              onSessionContinue();
            }}
          >
            Continue for this session
          </button>
        )}
      </div>
    </section>
  );
}
