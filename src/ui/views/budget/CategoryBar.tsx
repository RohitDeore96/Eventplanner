import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';

export function CategoryBar({
  category,
  plan,
}: {
  category: { planned: number; committed: number; paid: number; name: string };
  plan: Plan;
}) {
  const planned = Math.max(category.planned, 1);
  const committedPct = Math.min(100, Math.round((category.committed / planned) * 100));
  const paidPct = Math.min(100, Math.round((category.paid / planned) * 100));
  return (
    <div className="cat-row">
      <span>{category.name}</span>
      <div
        className="moneybar"
        role="img"
        aria-label={`${category.name}: committed ${committedPct}% of plan, paid ${paidPct}%`}
      >
        <span className="planned" style={{ width: '100%' }} />
        <span className="committed" style={{ width: `${committedPct}%` }} />
        <span className="paid" style={{ width: `${paidPct}%` }} />
      </div>
      <span className="figures">{money(category.planned, plan)}</span>
    </div>
  );
}
