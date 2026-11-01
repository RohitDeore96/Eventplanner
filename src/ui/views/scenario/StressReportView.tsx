import type { StressReport } from '../../../engine/scenario';
import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';

/** The simulated stress report; nothing here is applied to the plan. */
export function StressReportView({
  plan,
  stress,
}: {
  plan: Plan;
  stress: StressReport;
}): React.ReactNode {
  return (
    <div aria-live="polite">
      <h3>
        {stress.survives ? 'The plan survives' : 'The plan breaks'}{' '}
        <span className="muted">(simulated — not applied)</span>
      </h3>
      <ul>
        <li>
          Guests: {plan.guestTarget} → {stress.guestTargetAfter}
        </li>
        <li>
          Budget: {money(plan.budgetMinor, plan)} → {money(stress.budgetAfter, plan)}
        </li>
        <li>Committed after the shocks: {money(stress.committedAfter, plan)}</li>
        {stress.overBudgetBy > 0 && <li>Over budget by: {money(stress.overBudgetBy, plan)}</li>}
        {stress.errorCount > 0 && <li>{stress.errorCount} error-level warning(s) would appear</li>}
        {stress.comparison.newWarnings.length > 0 && (
          <li>{stress.comparison.newWarnings.length} new warning(s) in total</li>
        )}
        {stress.comparison.resolvedWarnings.length > 0 && (
          <li>{stress.comparison.resolvedWarnings.length} warning(s) would clear</li>
        )}
      </ul>
    </div>
  );
}
