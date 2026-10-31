import { useMemo, useState } from 'react';
import { parseMajorAmount } from '../../engine/money';
import { summarize } from '../../engine/summary';
import { budgetTotals } from '../../engine/budget';
import { tradeOffActions, tradeOffFor, type TradeOffPlan } from '../../engine/tradeoff';
import type { Plan } from '../../engine/types';
import { localToday, money } from '../../lib/format';
import { usePlan } from '../../state/store';
import { text } from './form';
import { ScenarioPanel } from './ScenarioPanel';

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

/** Per-category allocation inputs with lock toggles (M10.1). */
function AllocationEditor({
  plan,
  unallocated,
  onNotice,
}: {
  plan: Plan;
  unallocated: number;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function draftFor(categoryId: string, plannedMinor: number): string {
    const existing = drafts[categoryId];
    if (existing !== undefined) return existing;
    const exponent = plan.currency === 'JPY' ? 0 : 2;
    return String(Math.round(plannedMinor / 10 ** currencyExponentOf(plan.currency, exponent)));
  }

  return (
    <section className="card" aria-labelledby="editalloc-title">
      <h2 id="editalloc-title">Edit category allocations</h2>
      <p className="muted">
        Change what each category may spend, or lock the ones you do not want touched.
        {unallocated > 0 && ` ${money(unallocated, plan)} of the budget is still unallocated.`}
        {unallocated < 0 && ` Allocations exceed the budget by ${money(-unallocated, plan)}.`}
      </p>
      <table>
        <caption className="visually-hidden">Allocation editor with lock toggles</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Allocated</th>
            <th scope="col">Lock</th>
            <th scope="col">
              <span className="visually-hidden">Apply</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {plan.categories.map((category) => (
            <tr key={category.id}>
              <th scope="row">
                {category.name}
                {category.locked && (
                  <span className="badge">
                    <span aria-hidden="true">🔒</span> locked
                  </span>
                )}
              </th>
              <td>
                <label className="visually-hidden" htmlFor={`alloc-${category.id}`}>
                  Allocation for {category.name} in {plan.currency}
                </label>
                <input
                  id={`alloc-${category.id}`}
                  inputMode="decimal"
                  value={draftFor(category.id, category.plannedMinor)}
                  disabled={category.locked}
                  size={10}
                  onChange={(event) => {
                    setDrafts((current) => ({ ...current, [category.id]: event.target.value }));
                  }}
                />
              </td>
              <td>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={category.locked}
                    aria-label={`Lock ${category.name}`}
                    onChange={(event) => {
                      const outcome = store.apply({
                        type: 'category/update',
                        id: category.id,
                        locked: event.target.checked,
                      });
                      onNotice(
                        outcome.ok
                          ? event.target.checked
                            ? `${category.name} locked.`
                            : `${category.name} unlocked.`
                          : (outcome.message ?? 'That change was rejected.'),
                      );
                    }}
                  />{' '}
                  Keep safe
                </label>
              </td>
              <td>
                <button
                  type="button"
                  disabled={category.locked}
                  onClick={() => {
                    const amount = parseMajorAmount(drafts[category.id] ?? '', plan.currency);
                    if (amount === null) {
                      onNotice('Enter the allocation in major units, e.g. 800000.');
                      return;
                    }
                    const outcome = store.apply({
                      type: 'category/update',
                      id: category.id,
                      plannedMinor: amount,
                    });
                    onNotice(
                      outcome.ok
                        ? `${category.name} set to ${money(amount, plan)}.`
                        : (outcome.message ?? 'That change was rejected.'),
                    );
                    if (outcome.ok) {
                      setDrafts(({ [category.id]: _cleared, ...rest }) => rest);
                    }
                  }}
                >
                  Set
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function currencyExponentOf(currency: string, fallback: number): number {
  // Inline exponent lookup for the input display only; money math stays in the engine.
  if (currency === 'JPY') return 0;
  if (currency === 'KWD') return 3;
  return fallback;
}

/**
 * Trade-off planner (M10.3): fund one category without exceeding the budget. The plan is
 * shown first; applying runs the engine's own category/update actions as ONE undo step.
 */
function TradeOffCard({
  plan,
  onNotice,
}: {
  plan: Plan;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const [toId, setToId] = useState(plan.categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [proposal, setProposal] = useState<TradeOffPlan | null>(null);

  function build(): void {
    const increase = parseMajorAmount(amount, plan.currency);
    if (increase === null) {
      onNotice('Enter the increase in major units, e.g. 50000.');
      setProposal(null);
      return;
    }
    const result = tradeOffFor(plan, toId, increase);
    if (!result.ok) {
      onNotice(result.error.message);
      setProposal(null);
      return;
    }
    setProposal(result.value);
    onNotice(null);
  }

  function apply(): void {
    if (proposal === null) return;
    const actions = tradeOffActions(proposal);
    const outcome = store.applyAll(
      actions,
      `Trade-off: ${proposal.toName} +${money(proposal.increaseMinor, plan)}`,
    );
    onNotice(
      outcome.ok
        ? `Trade-off applied as one undo step — ${proposal.toName} now has ${money(proposal.plannedAfter, plan)}.`
        : (outcome.message ?? 'The trade-off could not be applied.'),
    );
    setProposal(null);
    setAmount('');
  }

  return (
    <section className="card" aria-labelledby="tradeoff-title">
      <h2 id="tradeoff-title">Fund a category without overspending</h2>
      <p className="muted">
        Pick where the extra money should go; Utsav finds it from unallocated budget and the freest
        categories — locked categories and money already committed are never touched.
      </p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          build();
        }}
      >
        <div>
          <label htmlFor="trade-to">Category to fund</label>
          <select
            id="trade-to"
            value={toId}
            onChange={(event) => {
              setToId(event.target.value);
              setProposal(null);
            }}
          >
            {plan.categories.map((c) => (
              <option key={c.id} value={c.id} disabled={c.locked}>
                {c.name}
                {c.locked ? ' (locked)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="trade-amount">Extra money needed</label>
          <input
            id="trade-amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </div>
        <button type="submit" className="primary">
          Show the trade-off
        </button>
      </form>
      {proposal !== null && (
        <div aria-live="polite">
          <h3>
            Proposed: {proposal.toName} {money(proposal.plannedBefore, plan)} →{' '}
            {money(proposal.plannedAfter, plan)}{' '}
            <span className="muted">(nothing applied yet)</span>
          </h3>
          <ul>
            <li>
              From unallocated budget:{' '}
              {money(
                Math.min(Math.max(proposal.unallocatedBefore, 0), proposal.increaseMinor),
                plan,
              )}{' '}
              — {money(proposal.unallocatedAfter, plan)} unallocated afterwards.
            </li>
            {proposal.sources.map((source) => (
              <li key={source.categoryId}>
                {source.name}: {money(source.plannedBefore, plan)} →{' '}
                {money(source.plannedAfter, plan)} (has {money(source.slackMinor, plan)} not yet
                committed).
              </li>
            ))}
            {proposal.shortfallMinor > 0 && (
              <li>
                <strong>
                  {money(proposal.shortfallMinor, plan)} cannot be covered without breaking the
                  budget or touching locked/committed money — reduce the request or unlock a
                  category.
                </strong>
              </li>
            )}
          </ul>
          {proposal.shortfallMinor === 0 && (
            <button type="button" className="primary" onClick={apply}>
              Apply this trade-off
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setProposal(null);
            }}
          >
            Discard
          </button>
        </div>
      )}
    </section>
  );
}

/** Expense log with vendor/instalment linking, edit, search and filters (M6). */
function ExpenseSection({
  plan,
  onNotice,
}: {
  plan: Plan;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);

  const visible = plan.expenses.filter((expense) => {
    const q = query.trim().toLowerCase();
    const matchesQuery = q.length === 0 || expense.note.toLowerCase().includes(q);
    const matchesCategory = categoryFilter === 'all' || expense.categoryId === categoryFilter;
    const matchesVendor = vendorFilter === 'all' || expense.vendorId === vendorFilter;
    const matchesLink =
      linkFilter === 'all' ||
      (linkFilter === 'linked' && expense.vendorId !== null) ||
      (linkFilter === 'unlinked' && expense.vendorId === null);
    return matchesQuery && matchesCategory && matchesVendor && matchesLink;
  });

  return (
    <section className="card" aria-labelledby="expense-title">
      <h2 id="expense-title">Expenses</h2>
      <ExpenseForm plan={plan} onNotice={onNotice} />
      {plan.expenses.length > 0 && (
        <>
          <div className="row">
            <div>
              <label htmlFor="xp-search">Search notes</label>
              <input
                id="xp-search"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            <div>
              <label htmlFor="xp-cat-filter">Category</label>
              <select
                id="xp-cat-filter"
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                }}
              >
                <option value="all">All categories</option>
                {plan.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="xp-vendor-filter">Vendor</label>
              <select
                id="xp-vendor-filter"
                value={vendorFilter}
                onChange={(event) => {
                  setVendorFilter(event.target.value);
                }}
              >
                <option value="all">All vendors</option>
                <option value="">No vendor</option>
                {plan.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="xp-link-filter">Linkage</label>
              <select
                id="xp-link-filter"
                value={linkFilter}
                onChange={(event) => {
                  setLinkFilter(event.target.value as 'all' | 'linked' | 'unlinked');
                }}
              >
                <option value="all">All expenses</option>
                <option value="linked">Linked to a vendor</option>
                <option value="unlinked">Direct spend</option>
              </select>
            </div>
          </div>
          <table>
            <caption className="visually-hidden">Expenses logged so far</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Category</th>
                <th scope="col">Vendor / payment</th>
                <th scope="col">Amount</th>
                <th scope="col">Note</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((expense) =>
                editingId === expense.id ? (
                  <tr key={expense.id}>
                    <td colSpan={6}>
                      <ExpenseEditForm
                        plan={plan}
                        expenseId={expense.id}
                        onDone={() => {
                          setEditingId(null);
                        }}
                        onNotice={onNotice}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={expense.id}>
                    <td>{expense.dateISO}</td>
                    <td>{nameOf(plan, expense.categoryId)}</td>
                    <td>
                      {expense.vendorId === null
                        ? 'Direct spend'
                        : (plan.vendors.find((v) => v.id === expense.vendorId)?.name ??
                          'Unknown vendor')}
                      {expense.instalmentId !== null && (
                        <div className="muted">settles a scheduled payment</div>
                      )}
                    </td>
                    <td>{money(expense.amountMinor, plan)}</td>
                    <td>{expense.note || '—'}</td>
                    <td>
                      <div className="row">
                        <button
                          type="button"
                          className="subtle"
                          onClick={() => {
                            setEditingId(expense.id);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="subtle"
                          onClick={() => {
                            const outcome = store.apply({
                              type: 'expense/delete',
                              id: expense.id,
                            });
                            onNotice(
                              outcome.ok
                                ? 'Expense removed.'
                                : (outcome.message ?? 'That expense was not removed.'),
                            );
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {visible.length === 0 && <p className="muted">No expenses match these filters.</p>}
        </>
      )}
    </section>
  );
}

/** Add-expense form with the vendor → instalment cascade (M6.2). */
function ExpenseForm({
  plan,
  onNotice,
}: {
  plan: Plan;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const [vendorId, setVendorId] = useState('');
  const [instalmentId, setInstalmentId] = useState('');
  const selectedVendor =
    vendorId === '' ? null : (plan.vendors.find((v) => v.id === vendorId) ?? null);
  return (
    <form
      className="row"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const amount = parseMajorAmount(text(data, 'amount'), plan.currency);
        const vendor = vendorId === '' ? null : vendorId;
        const instalment = vendor === null || instalmentId === '' ? null : instalmentId;
        // A vendor's expense must sit in the vendor's own category (engine rule) — pick it
        // for the family instead of letting a mismatch fail later.
        const categoryId =
          vendor !== null
            ? (plan.vendors.find((v) => v.id === vendor)?.categoryId ?? text(data, 'category'))
            : text(data, 'category');
        const outcome = store.apply({
          type: 'expense/add',
          id: `xp-${Date.now().toString(36)}`,
          categoryId,
          vendorId: vendor,
          instalmentId: instalment,
          dateISO: text(data, 'date'),
          amountMinor: amount ?? -1,
          note: text(data, 'note'),
        });
        if (outcome.ok) {
          form.reset();
          setVendorId('');
          setInstalmentId('');
          onNotice('Expense recorded.');
        } else {
          onNotice(outcome.message ?? 'That expense was not recorded.');
        }
      }}
    >
      <div>
        <label htmlFor="xp-category">Category</label>
        <select id="xp-category" name="category" disabled={selectedVendor !== null}>
          {plan.categories.map((c) => (
            <option
              key={c.id}
              value={c.id}
              selected={selectedVendor !== null && c.id === selectedVendor.categoryId}
            >
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="xp-vendor">Vendor (optional)</label>
        <select
          id="xp-vendor"
          value={vendorId}
          onChange={(event) => {
            setVendorId(event.target.value);
            // An instalment belongs to ONE vendor: switching vendors clears the choice.
            setInstalmentId('');
          }}
        >
          <option value="">No vendor — direct spend</option>
          {plan.vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="xp-instalment">
          {selectedVendor === null
            ? 'Payment instalment (needs a vendor)'
            : selectedVendor.schedule.length === 0
              ? `${selectedVendor.name} has no scheduled payments`
              : 'Payment instalment (optional)'}
        </label>
        <select
          id="xp-instalment"
          value={instalmentId}
          disabled={selectedVendor === null || selectedVendor.schedule.length === 0}
          onChange={(event) => {
            setInstalmentId(event.target.value);
          }}
        >
          <option value="">Not linked to an instalment</option>
          {(selectedVendor?.schedule ?? []).map((instalment) => (
            <option key={instalment.id} value={instalment.id}>
              {instalment.kind} · due {instalment.dueISO} · {money(instalment.amountMinor, plan)}
              {instalment.note.length > 0 ? ` · ${instalment.note}` : ''}
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
  );
}

/** Edit form including vendor/instalment re-assignment (M6.2). */
function ExpenseEditForm({
  plan,
  expenseId,
  onDone,
  onNotice,
}: {
  plan: Plan;
  expenseId: string;
  onDone: () => void;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const expense = plan.expenses.find((x) => x.id === expenseId);
  if (expense === undefined) return null;
  const [vendorId, setVendorId] = useState(expense.vendorId ?? '');
  const [instalmentId, setInstalmentId] = useState(expense.instalmentId ?? '');
  const selectedVendor =
    vendorId === '' ? null : (plan.vendors.find((v) => v.id === vendorId) ?? null);
  return (
    <form
      className="row"
      aria-label="Edit expense"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const amount = parseMajorAmount(text(data, 'amount'), plan.currency);
        const vendor = vendorId === '' ? null : vendorId;
        const instalment = vendor === null || instalmentId === '' ? null : instalmentId;
        const outcome = store.apply({
          type: 'expense/update',
          id: expenseId,
          amountMinor: amount ?? expense.amountMinor,
          dateISO: text(data, 'date'),
          note: text(data, 'note'),
          vendorId: vendor,
          instalmentId: instalment,
        });
        if (outcome.ok) {
          onNotice('Expense updated.');
          onDone();
        } else {
          onNotice(outcome.message ?? 'That expense was not updated.');
        }
      }}
    >
      <div>
        <label htmlFor={`xe-${expenseId}-amount`}>Amount</label>
        <input
          id={`xe-${expenseId}-amount`}
          name="amount"
          inputMode="decimal"
          defaultValue={String(Math.round(expense.amountMinor / 100))}
          required
        />
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-date`}>Date</label>
        <input
          id={`xe-${expenseId}-date`}
          name="date"
          type="date"
          defaultValue={expense.dateISO}
          required
        />
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-vendor`}>
          Vendor (this expense's category: {nameOf(plan, expense.categoryId)})
        </label>
        <select
          id={`xe-${expenseId}-vendor`}
          value={vendorId}
          onChange={(event) => {
            setVendorId(event.target.value);
            setInstalmentId('');
          }}
        >
          <option value="">No vendor — direct spend</option>
          {/* The engine requires the expense's category to match its vendor's category, so
              only vendors of this expense's own category are offered here. */}
          {plan.vendors
            .filter((v) => v.categoryId === expense.categoryId)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-inst`}>Payment instalment</label>
        <select
          id={`xe-${expenseId}-inst`}
          value={instalmentId}
          disabled={selectedVendor === null || selectedVendor.schedule.length === 0}
          onChange={(event) => {
            setInstalmentId(event.target.value);
          }}
        >
          <option value="">Not linked to an instalment</option>
          {(selectedVendor?.schedule ?? []).map((instalment) => (
            <option key={instalment.id} value={instalment.id}>
              {instalment.kind} · due {instalment.dueISO}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`xe-${expenseId}-note`}>Note</label>
        <input
          id={`xe-${expenseId}-note`}
          name="note"
          defaultValue={expense.note}
          maxLength={500}
        />
      </div>
      <button type="submit" className="primary">
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          onDone();
        }}
      >
        Cancel
      </button>
      <p className="muted">
        Amounts are in major units ({plan.currency}); a scheduled payment that is already partly
        paid keeps its history when you change the vendor — the old link is simply cleared.
      </p>
    </form>
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
