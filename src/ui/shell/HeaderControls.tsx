import { useState } from 'react';
import { localToday } from '../../lib/format';
import { exportCsv, exportJson, exportSummary } from '../../lib/export';
import { LANGS, translate, type Lang } from '../../lib/i18n';
import { buildDemoPlan } from '../../state/demo';
import { clearSavedPlan, savePlan } from '../../state/persistence';
import { usePlanStore } from '../../state/store';

export function HeaderControls({
  store,
  hasPlan,
  lang,
  onLang,
}: {
  store: ReturnType<typeof usePlanStore>;
  hasPlan: boolean;
  lang: Lang;
  onLang: (lang: Lang) => void;
}): React.ReactNode {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="row">
      <label className="lang-picker">
        <span className="muted">{translate(lang, 'header.language')}</span>
        <select
          value={lang}
          aria-label={translate(lang, 'header.language')}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'en' || next === 'hi' || next === 'mr') onLang(next);
          }}
        >
          {LANGS.map((option) => (
            <option key={option.id} value={option.id} lang={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {!hasPlan && (
        <button
          type="button"
          onClick={() => {
            const demo = buildDemoPlan(localToday());
            if (demo !== null) {
              savePlan(demo);
              store.replace(demo);
              window.location.reload();
            }
          }}
        >
          {translate(lang, 'header.loadDemo')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportJson(store.state.history.present);
          }}
        >
          {translate(lang, 'header.exportJson')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportCsv(store.state.history.present);
          }}
        >
          {translate(lang, 'header.exportCsv')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportSummary(store.state.history.present);
          }}
        >
          {translate(lang, 'header.exportSummary')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            store.undo();
          }}
          disabled={store.state.history.past.length === 0}
        >
          {translate(lang, 'header.undo')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            store.redo();
          }}
          disabled={store.state.history.future.length === 0}
        >
          {translate(lang, 'header.redo')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            setConfirmReset(true);
          }}
        >
          {translate(lang, 'header.reset')}
        </button>
      )}
      {hasPlan && confirmReset && (
        <>
          <button
            type="button"
            className="danger"
            onClick={() => {
              clearSavedPlan();
              window.location.reload();
            }}
          >
            {translate(lang, 'header.resetConfirm')}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmReset(false);
            }}
          >
            {translate(lang, 'header.resetCancel')}
          </button>
        </>
      )}
    </div>
  );
}
