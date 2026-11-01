import { useMemo, useState } from 'react';
import { parseMajorAmount } from '../../../engine/money';
import { summarize } from '../../../engine/summary';
import { budgetTotals } from '../../../engine/budget';
import type { Plan } from '../../../engine/types';
import { localToday, money } from '../../../lib/format';
import { usePlan } from '../../../state/store';
import { text } from '../form';
import { ScenarioPanel } from '../ScenarioPanel';
import { AllocationEditor } from './AllocationEditor';
import { CategoryBar } from './CategoryBar';
import { ExpenseSection } from './ExpenseSection';
import { TradeOffCard } from './TradeOffCard';
import { nameOf } from './shared';

/**
 * Budget: planned vs committed vs paid per category, allocations with locks and trade-offs,
 * and the expense log with vendor/instalment linking. All figures come from the engine's
 * summarize(); the UI never computes money itself.
 */
export function BudgetView({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = useMemo(() => localToday(), []);
  const summary = useMemo(() => summarize(plan, today), [plan, today]);
  const totals = useMemo(() => budgetTotals(plan), [plan]);
  const unallocated = totals.budget - totals.planned;
  const [notice, setNotice] = useState<string | null>(null);

  function moveMoney(formData: FormData) {
    const fromId = text(formData, 'from');
    const toId = text(formData, 'to');
    const amount = parseMajorAmount(text(formData, 'amount'), plan.currency);
    const outcome = store.apply({
      type: 'budget/move',
      fromId,
      toId,
      amountMinor: amount ?? -1,
    });
    setNotice(
      outcome.ok
        ? `Moved ${money(amount ?? 0, plan)} from ${nameOf(plan, fromId)} to ${nameOf(plan, toId)}.`
        : (outcome.message ?? 'That move was not possible.'),
    );
  }

  return (
    <>
      {summary.warnings.length > 0 && (
        <section aria-label="Warnings" className="card">
          <h2>What needs attention</h2>
          {summary.warnings.map((warning) => (
            <div
              key={warning.id}
              className={`alert ${warning.severity === 'error' ? 'error' : ''}`}
            >
              <strong>
                <span aria-hidden="true">{warning.severity === 'error' ? '⛔' : '⚠️'}</span>{' '}
                {warning.severity === 'error' ? 'Error' : 'Warning'}: {warning.message}
              </strong>
              <p className="fix">Suggestion: {warning.fix}</p>
            </div>
          ))}
        </section>
      )}

      <section className="card" aria-labelledby="alloc-title">
        <h2 id="alloc-title">Where the budget stands</h2>
        <table tabIndex={0}>
          <caption className="visually-hidden">
            Budget categories with planned, committed, paid and remaining amounts
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Planned</th>
              <th scope="col">Committed</th>
              <th scope="col">Paid</th>
              <th scope="col">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {summary.categories.map((category) => (
              <tr key={category.categoryId}>
                <th scope="row">{category.name}</th>
                <td>{money(category.planned, plan)}</td>
                <td>{money(category.committed, plan)}</td>
                <td>{money(category.paid, plan)}</td>
                <td>
                  {category.remaining < 0 ? (
                    <span className="badge error">
                      <span aria-hidden="true">⛔</span> {money(-category.remaining, plan)} over
                    </span>
                  ) : (
                    money(category.remaining, plan)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{money(summary.totals.planned, plan)}</td>
              <td>{money(summary.totals.committed, plan)}</td>
              <td>{money(summary.totals.paid, plan)}</td>
              <td>{money(summary.totals.remaining, plan)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="muted">
          Budget {money(summary.totals.budget, plan)} · allocated{' '}
          {money(summary.totals.planned, plan)} ·{' '}
          {unallocated >= 0
            ? `${money(unallocated, plan)} still unallocated`
            : `allocations exceed the budget by ${money(-unallocated, plan)}`}
        </p>
        {summary.categories.map((category) => (
          <CategoryBar key={category.categoryId} category={category} plan={plan} />
        ))}
      </section>

      <AllocationEditor plan={plan} unallocated={unallocated} onNotice={setNotice} />
      <TradeOffCard plan={plan} onNotice={setNotice} />

      <section className="card" aria-labelledby="move-title">
        <h2 id="move-title">Move money between categories</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            moveMoney(new FormData(event.currentTarget));
          }}
        >
          <div>
            <label htmlFor="move-from">From</label>
            <select id="move-from" name="from">
              {plan.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.locked ? ' (locked)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="move-to">To</label>
            <select id="move-to" name="to" defaultValue={plan.categories[1]?.id}>
              {plan.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.locked ? ' (locked)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="move-amount">Amount to move</label>
            <input id="move-amount" name="amount" inputMode="decimal" required />
          </div>
          <button type="submit" className="primary">
            Move
          </button>
        </form>
        <p className="muted">
          Locked categories refuse moves and allocation edits until you unlock them.
        </p>
        {notice !== null && (
          <p role="status" className="muted">
            {notice}
          </p>
        )}
      </section>

      <ExpenseSection plan={plan} onNotice={setNotice} />
      <ScenarioPanel plan={plan} />
    </>
  );
}
