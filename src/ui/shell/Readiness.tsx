import { useMemo } from 'react';
import { summarize } from '../../engine/summary';
import type { Plan } from '../../engine/types';
import { localToday } from '../../lib/format';
import { translate, type Lang } from '../../lib/i18n';

export function Readiness({ plan, lang }: { plan: Plan; lang: Lang }) {
  const today = localToday();
  const summary = useMemo(() => summarize(plan, today), [plan, today]);
  const done = summary.readiness.tasksDone;
  const total = summary.readiness.tasksTotal;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const label =
    summary.readiness.status === 'on_track'
      ? translate(lang, 'readiness.onTrack')
      : summary.readiness.status === 'at_risk'
        ? translate(lang, 'readiness.atRisk')
        : translate(lang, 'readiness.needsAttention');
  return (
    <p className="readiness">
      <span className={`badge ${summary.readiness.status === 'on_track' ? 'success' : 'warn'}`}>
        <span aria-hidden="true">{summary.readiness.status === 'on_track' ? '✓' : '!'}</span>{' '}
        {label}
      </span>
      <progress max={100} value={pct} aria-label={`${translate(lang, 'readiness.aria')} ${pct}%`} />
      <span>{pct}%</span>
    </p>
  );
}
