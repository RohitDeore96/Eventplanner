import { useState } from 'react';
import { currencyExponent, parseMajorAmount } from '../../../engine/money';
import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';
import { usePlan } from '../../../state/store';

export /** Per-category allocation inputs with lock toggles (M10.1). */
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
    // Major units for the input display; the exponent comes from the engine's single currency
    // table (the `?? 2` is unreachable for plans built by buildPlan, which rejects unknown
    // codes, and only keeps this display defined if a hand-built plan ever carries one).
    const exponent = currencyExponent(plan.currency) ?? 2;
    return String(Math.round(plannedMinor / 10 ** exponent));
  }

  return (
    <section className="card" aria-labelledby="editalloc-title">
      <h2 id="editalloc-title">Edit category allocations</h2>
      <p className="muted">
        Change what each category may spend, or lock the ones you do not want touched.
        {unallocated > 0 && ` ${money(unallocated, plan)} of the budget is still unallocated.`}
        {unallocated < 0 && ` Allocations exceed the budget by ${money(-unallocated, plan)}.`}
      </p>
      <table tabIndex={0}>
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
