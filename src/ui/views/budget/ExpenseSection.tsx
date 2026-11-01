import { useState } from 'react';
import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';
import { usePlan } from '../../../state/store';
import { ExpenseEditForm } from './ExpenseEditForm';
import { ExpenseForm } from './ExpenseForm';
import { nameOf } from './shared';

export /** Expense log with vendor/instalment linking, edit, search and filters (M6). */
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
          <table tabIndex={0}>
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
