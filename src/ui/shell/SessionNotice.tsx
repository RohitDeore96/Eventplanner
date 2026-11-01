/**
 * The persistent companion of the "continue for this session" recovery choice: once the
 * family is planning on the volatile session store, this quiet status line keeps
 * explaining that nothing is written to the device — the one claim the recovery card
 * made that must not silently disappear once the card does. It is app chrome, so it
 * speaks the chosen language like the rest of the shell.
 */
import { translate, type Lang } from '../../lib/i18n';

export function SessionNotice({ show, lang }: { show: boolean; lang: Lang }): React.ReactNode {
  if (!show) return null;
  return (
    <p className="alert" role="status">
      <strong>
        <span aria-hidden="true">⚠️</span> {translate(lang, 'session.notice')}
      </strong>{' '}
      {translate(lang, 'session.advice')}
    </p>
  );
}
