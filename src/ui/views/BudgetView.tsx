import { useMemo, useState } from 'react';
import { parseMajorAmount } from '../../engine/money';
import { summarize } from '../../engine/summary';
import type { Plan } from '../../engine/types';
import { localToday, money } from '../../lib/format';
import { usePlan } from '../../state/store';
import { text } from './form';
import { ScenarioPanel } from './ScenarioPanel';

/**
 * Budget: planned vs committed vs paid per category, moving money between categories, and
 * the expense log. All figures come from the engine's summarize(); the UI never computes money.
 */
export function BudgetView({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = useMemo(() => localToday(), []);
  const summary = useMemo(() => summarize(plan, today), [plan, today]);
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

  function addExpense(formData: FormData, form: HTMLFormElement) {
    const amount = parseMajorAmount(text(formData, 'amount'), plan.currency);
    const outcome = store.apply({
      type: 'expense/add',
      id: `xp-${Date.now().toString(36)}`,
      categoryId: text(formData, 'category'),
      vendorId: null,
      instalmentId: null,
      dateISO: text(formData, 'date'),
      amountMinor: amount ?? -1,
      note: text(formData, 'note'),
    });
    if (outcome.ok) {
      form.reset();
      setNotice('Expense recorded.');
    } else {
      setNotice(outcome.message ?? 'That expense was not recorded.');
    }
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
        <table>
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
          Budget {money(summary.totals.budget, plan)} · bars show planned, committed and paid
          shares.
        </p>
        {summary.categories.map((category) => (
          <CategoryBar key={category.categoryId} category={category} plan={plan} />
        ))}
      </section>

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
        {notice !== null && (
          <p role="status" className="muted">
            {notice}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="expense-title">
        <h2 id="expense-title">Log an expense</h2>
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            addExpense(new FormData(event.currentTarget), event.currentTarget);
          }}
        >
          <div>
            <label htmlFor="xp-category">Category</label>
            <select id="xp-category" name="category">
              {plan.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="xp-amount">Amount spent</label>
            <input id="xp-amount" name="amount" inputMode="decimal" required />
          </div>
          <div>
            <label htmlFor="xp-date">Date</label>
            <input id="xp-date" name="date" type="date" required />
          </div>
          <div>
            <label htmlFor="xp-note">Note (optional)</label>
            <input id="xp-note" name="note" maxLength={500} />
          </div>
          <button type="submit" className="primary">
            Add expense
          </button>
        </form>
        {plan.expenses.length > 0 && (
          <table>
            <caption className="visually-hidden">Expenses logged so far</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Category</th>
                <th scope="col">Amount</th>
                <th scope="col">Note</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.expenses.map((expense) => (
                <tr key={expense.id}>
                  <td>{expense.dateISO}</td>
                  <td>{nameOf(plan, expense.categoryId)}</td>
                  <td>{money(expense.amountMinor, plan)}</td>
                  <td>{expense.note || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="subtle"
                      onClick={() => {
                        store.apply({ type: 'expense/delete', id: expense.id });
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <ScenarioPanel plan={plan} />
    </>
  );
}

function CategoryBar({
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

function nameOf(plan: Plan, categoryId: string): string {
  return plan.categories.find((c) => c.id === categoryId)?.name ?? 'Unknown';
}
