/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../../src/engine/types';
import { usePlan } from '../../src/state/store';
import { ExpenseEditForm } from '../../src/ui/views/budget/ExpenseEditForm';
import { catId, makePlan, run } from '../helpers';
import { Harness, fireEventSubmit } from './harness';

/**
 * Regression guards for the expense edit form's own contract (M6.2): every mount and
 * re-mount of the component calls the same hooks in the same order — including when the
 * expense is missing or removed while the form is open — and the edit flow still saves
 * through the real store.
 */

const expensePlan = (): Plan =>
  run(makePlan(), {
    type: 'expense/add',
    id: 'x1',
    categoryId: catId(makePlan(), 'venue'),
    vendorId: null,
    instalmentId: null,
    dateISO: '2026-12-20',
    amountMinor: 2_000_000,
    note: 'venue advance',
  });

/** Dispatches expense/delete through the real store, as any other view could. */
function DeleteExpense({ id }: { id: string }): React.ReactNode {
  const store = usePlan();
  return (
    <button
      type="button"
      onClick={() => {
        store.apply({ type: 'expense/delete', id });
      }}
    >
      remove-expense-x1
    </button>
  );
}

/** Undoes the last change through the real store, as the app header could. */
function UndoButton(): React.ReactNode {
  const store = usePlan();
  return (
    <button
      type="button"
      onClick={() => {
        store.undo();
      }}
    >
      undo-expense-delete
    </button>
  );
}

describe('expense edit form hooks contract', () => {
  it('renders nothing and fires no callbacks when the expense is already gone', () => {
    let done = 0;
    let notice: string | null | undefined;
    render(
      <Harness seed={expensePlan()}>
        {(current) => (
          <ExpenseEditForm
            plan={current}
            expenseId="ghost"
            onDone={() => {
              done += 1;
            }}
            onNotice={(n) => {
              notice = n;
            }}
          />
        )}
      </Harness>,
    );
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();
    expect(done).toBe(0);
    expect(notice).toBeUndefined();
  });

  it('keeps hooks consistent when the expense is removed while the form is open, then restored', async () => {
    const user = userEvent.setup();
    render(
      <Harness seed={expensePlan()}>
        {(current) => (
          <>
            <ExpenseEditForm
              plan={current}
              expenseId="x1"
              onDone={() => undefined}
              onNotice={() => undefined}
            />
            <DeleteExpense id="x1" />
            <UndoButton />
          </>
        )}
      </Harness>,
    );
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();

    // The expense disappears (another view, an undo, a patch); the open form must simply
    // unmount — it must never re-render with fewer hooks than the previous render.
    await user.click(screen.getByRole('button', { name: 'remove-expense-x1' }));
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument();

    // The removal is undone and the form comes back. That re-mount can only be clean if
    // the component's hook count never depended on the expense being present.
    await user.click(screen.getByRole('button', { name: 'undo-expense-delete' }));
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toHaveValue('20000');
    expect(screen.getByLabelText('Note')).toHaveValue('venue advance');
  });

  it('still seeds from the expense and saves the edit through the store', async () => {
    const user = userEvent.setup();
    let done = 0;
    let notice: string | null | undefined;
    const latest: { plan: Plan | null } = { plan: null };
    render(
      <Harness seed={expensePlan()}>
        {(current) => {
          latest.plan = current;
          return (
            <ExpenseEditForm
              plan={current}
              expenseId="x1"
              onDone={() => {
                done += 1;
              }}
              onNotice={(n) => {
                notice = n;
              }}
            />
          );
        }}
      </Harness>,
    );
    expect(screen.getByLabelText('Note')).toHaveValue('venue advance');
    expect(screen.getByLabelText("Vendor (this expense's category: Venue)")).toHaveValue('');

    const amount = screen.getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '21000');
    fireEventSubmit(amount);
    await waitFor(() => {
      expect(notice).toBe('Expense updated.');
    });
    expect(done).toBe(1);
    expect(latest.plan?.expenses.find((x) => x.id === 'x1')?.amountMinor).toBe(2_100_000);
  });
});
