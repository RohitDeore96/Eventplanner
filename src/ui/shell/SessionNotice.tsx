/**
 * The persistent companion of the "continue for this session" recovery choice: once the
 * family is planning on the volatile session store, this quiet status line keeps
 * explaining that nothing is written to the device — the one claim the recovery card
 * made that must not silently disappear once the card does.
 */
export function SessionNotice({ show }: { show: boolean }): React.ReactNode {
  if (!show) return null;
  return (
    <p className="alert" role="status">
      <strong>
        <span aria-hidden="true">⚠️</span> Saving is unavailable in this browser, so changes last
        only for this session.
      </strong>{' '}
      Nothing is written to this device — export your event if you want to keep it.
    </p>
  );
}
