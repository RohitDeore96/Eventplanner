import type { Plan } from '../../engine/types';
import type { Lang } from '../../lib/i18n';
import { usePlanStore } from '../../state/store';
import { HeaderControls } from './HeaderControls';
import { Readiness } from './Readiness';

/**
 * The masthead: brand, readiness badge, header controls and the two notices
 * (autosave problems and one-off action feedback). Pure presentation — the shell
 * passes the store and the current notice strings.
 */
export function Masthead({
  store,
  hasPlan,
  lang,
  onLang,
  current,
  saveNotice,
  actionNotice,
}: {
  store: ReturnType<typeof usePlanStore>;
  hasPlan: boolean;
  lang: Lang;
  onLang: (lang: Lang) => void;
  current: Plan;
  saveNotice: string | null;
  actionNotice: string | null;
}): React.ReactNode {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="brand">
          <img src="/logo.png" alt="" width={40} height={40} />
          <div>
            {/* Single page heading: the product name. Styled by .brand .name. */}
            <h1 className="name">Utsav</h1>
            <p className="tagline">Every utsav, one connected plan.</p>
          </div>
        </div>
        {hasPlan && <Readiness plan={current} lang={lang} />}
        <HeaderControls store={store} hasPlan={hasPlan} lang={lang} onLang={onLang} />
      </div>
      {saveNotice !== null && (
        <p className="alert" role="status">
          <strong>
            <span aria-hidden="true">⚠️</span> {saveNotice}
          </strong>{' '}
          Your plan is still open — export JSON to keep a copy, or free up browser storage and make
          a change to autosave again.
        </p>
      )}
      {actionNotice !== null && (
        <p className="alert" role="status">
          <strong>
            <span aria-hidden="true">✓</span> {actionNotice}
          </strong>
        </p>
      )}
    </header>
  );
}
