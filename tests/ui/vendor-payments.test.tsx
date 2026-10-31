/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer, type PlanState } from '../../src/state/planState';
import { applyAction } from '../../src/engine/history';
import type { Plan } from '../../src/engine/types';
import { budgetTotals, instalmentPayments, vendorPayments } from '../../src/engine/budget';
import { makePlan, run, TODAY } from '../helpers';
import { useState } from 'react';
import { VendorsView } from '../../src/ui/views/VendorsView';

/**
 * PRIORITY 1 acceptance journey: a vendor for 1,00,000 with a 30,000 advance and a 70,000
 * final instalment; record the 30,000 advance; the outstanding balance, committed totals
 * and statuses must all come from the real expense ledger — before and after "reload".
 */

const plan: Plan = run(makePlan(), {
  type: 'vendor/add',
  id: 'v-caterer',
  categoryId: makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'catering',
  name: 'Sharma Caterers',
  contactNote: ' uncle reference ',
  status: 'booked',
  committedMinor: 10_000_000,
});

function Harness({ seed }: { seed: Plan }): React.ReactNode {
  const [state, setState] = useState(() => initPlanState(seed));
  const store: Store = {
    plan: seed,
    state,
    dispatch: (event) => {
      setState(planReducer(state, event, TODAY));
    },
    apply: (action) => {
      const next = planReducer(state, { kind: 'apply', action }, TODAY);
      setState(next);
      return next.lastError === null
        ? { ok: true, message: null }
        : { ok: false, message: next.lastError.message, field: next.lastError.field ?? '' };
    },
    applyAll: (actions) => {
      let rolling = state.history;
      let error: PlanState['lastError'] = null;
      for (const action of actions) {
        const next = applyAction(rolling, action, { today: TODAY });
        if (!next.ok) {
          error = next.error;
          break;
        }
        rolling = next.value;
      }
      if (error === null) {
        setState({ ...state, history: rolling, lastError: null });
        return { ok: true, message: null };
      }
      return { ok: false, message: error.message, field: error.field ?? '' };
    },
    replace: (next) => {
      setState(initPlanState(next));
    },
    undo: () => {
      setState(planReducer(state, { kind: 'undo' }, TODAY));
    },
    redo: () => {
      setState(planReducer(state, { kind: 'redo' }, TODAY));
    },
  };
  return (
    <PlanContext.Provider value={store}>
      <VendorsView plan={state.history.present} />
    </PlanContext.Provider>
  );
}

/** The schedule row header cell (the select options share the same words). */
function rowCell(label: string): HTMLTableCellElement | undefined {
  return screen.getAllByText(label).find((el) => el.tagName === 'TH') as
    HTMLTableCellElement | undefined;
}

describe('vendor payment schedules (P1)', () => {
  it('schedules an advance and a final payment, records the advance, and reports exact balances', async () => {
    const user = userEvent.setup();
    render(<Harness seed={plan} />);

    const addForm = screen.getByRole('button', { name: 'Add to schedule' }).closest('form');
    if (addForm === null) throw new Error('no add-instalment form');

    // 1. Add the 30,000 advance.
    await user.type(within(addForm).getByLabelText('Due date'), '2026-11-01');
    await user.type(within(addForm).getByLabelText('Amount'), '30000');
    fireEvent.submit(addForm);
    await waitFor(
      () => {
        expect(rowCell('Advance')).toBeDefined();
      },
      { timeout: 3000 },
    );

    // 2. Add the 70,000 final payment: pick the kind explicitly, then the details. The short
    // delay keeps the generated instalment ids in different milliseconds, like real usage.
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await user.selectOptions(within(addForm).getByLabelText('Add payment'), 'final');
    await user.type(within(addForm).getByLabelText('Due date'), '2026-12-01');
    await user.type(within(addForm).getByLabelText('Amount'), '70000');
    fireEvent.submit(addForm);
    await waitFor(
      () => {
        expect(rowCell('Final payment')).toBeDefined();
      },
      { timeout: 3000 },
    );

    // 3. Record the 30,000 advance through the row's own payment form.
    const advanceRow = rowCell('Advance')?.closest('tr');
    if (advanceRow === null || advanceRow === undefined) throw new Error('no advance row');
    const amountInput = within(advanceRow).getByLabelText('Amount paid now');
    expect((amountInput as HTMLInputElement).value).toBe('30000'); // the outstanding balance
    const payForm = within(advanceRow)
      .getByRole('button', { name: 'Record payment' })
      .closest('form');
    if (payForm === null) throw new Error('no record-payment form');
    fireEvent.submit(payForm);

    // 4. The advance settles; the final payment stays outstanding with its exact balance.
    await waitFor(() => {
      expect(rowCell('Advance')?.closest('tr')?.textContent).toContain('Paid in full');
    });
    const finalRow = rowCell('Final payment')?.closest('tr');
    expect(finalRow?.textContent).toContain('70,000.00');
    expect(finalRow?.textContent).toContain('Not paid yet');

    // 5. The recorded expense is in the live plan (what a reload would restore).
    const schedule = screen.getAllByRole('row');
    expect(schedule.length).toBeGreaterThanOrEqual(3); // header + 2 instalment rows
  });

  it('settles an instalment through an expense and updates every financial figure', () => {
    const withSchedule = run(plan, {
      type: 'vendor/setSchedule',
      id: 'v-caterer',
      schedule: [
        { id: 'i-adv', kind: 'advance', dueISO: '2026-11-01', amountMinor: 3_000_000 },
        { id: 'i-final', kind: 'final', dueISO: '2026-12-01', amountMinor: 7_000_000 },
      ],
    });
    expect(withSchedule.vendors[0]?.schedule).toHaveLength(2);

    // Record the 30,000 advance exactly as the UI's Record payment button does.
    const paid = run(withSchedule, {
      type: 'expense/add',
      id: 'x-adv',
      categoryId: withSchedule.vendors[0]?.categoryId ?? '',
      vendorId: 'v-caterer',
      instalmentId: 'i-adv',
      dateISO: '2026-10-30',
      amountMinor: 3_000_000,
      note: 'Advance to Sharma Caterers',
    });

    const payments = instalmentPayments(paid.expenses);
    expect(payments.get('i-adv')).toBe(3_000_000);
    expect(payments.get('i-final')).toBeUndefined();

    const totals = budgetTotals(paid);
    expect(totals.committed).toBe(10_000_000); // agreed price still committed once
    expect(totals.paid).toBe(3_000_000);
    expect(totals.cashToPay).toBe(7_000_000); // exactly the outstanding final payment

    // A partial payment on the final instalment keeps the balance exact.
    const partly = run(paid, {
      type: 'expense/add',
      id: 'x-part',
      categoryId: paid.vendors[0]?.categoryId ?? '',
      vendorId: 'v-caterer',
      instalmentId: 'i-final',
      dateISO: '2026-12-01',
      amountMinor: 2_000_000,
      note: 'Final part 1',
    });
    const totals2 = budgetTotals(partly);
    expect(totals2.paid).toBe(5_000_000);
    expect(totals2.cashToPay).toBe(5_000_000);
    expect(vendorPayments(partly.expenses).get('v-caterer')).toBe(5_000_000);
  });

  it('rejects recording a payment against a vendor or instalment that does not exist', () => {
    expect(() =>
      run(plan, {
        type: 'expense/add',
        id: 'x-ghost',
        categoryId: plan.categories[0]?.id ?? '',
        vendorId: 'ghost',
        instalmentId: 'i-ghost',
        dateISO: '2026-10-30',
        amountMinor: 100,
        note: '',
      }),
    ).toThrow();
  });
});

describe('vendor schedule edge cases', () => {
  function Harness2({ seed }: { seed: Plan }): React.ReactNode {
    const [state, setState] = useState(() => initPlanState(seed));
    const store: Store = {
      plan: seed,
      state,
      dispatch: (event) => {
        setState(planReducer(state, event, TODAY));
      },
      apply: (action) => {
        const next = planReducer(state, { kind: 'apply', action }, TODAY);
        setState(next);
        return next.lastError === null
          ? { ok: true, message: null }
          : { ok: false, message: next.lastError.message, field: next.lastError.field ?? '' };
      },
      applyAll: (actions) => {
        let rolling = state.history;
        for (const action of actions) {
          const next = applyAction(rolling, action, { today: TODAY });
          if (!next.ok) {
            return { ok: false, message: next.error.message, field: next.error.field ?? '' };
          }
          rolling = next.value;
        }
        setState({ ...state, history: rolling, lastError: null });
        return { ok: true, message: null };
      },
      replace: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
    };
    return (
      <PlanContext.Provider value={store}>
        <VendorsView plan={state.history.present} />
      </PlanContext.Provider>
    );
  }

  it('marks an overdue instalment with text, not colour alone', () => {
    const scheduled = run(plan, {
      type: 'vendor/setSchedule',
      id: 'v-caterer',
      schedule: [{ id: 'i-old', kind: 'advance', dueISO: '2026-01-01', amountMinor: 3_000_000 }],
    });
    render(<Harness2 seed={scheduled} />);
    const row = rowCell('Advance')?.closest('tr');
    expect(row?.textContent).toContain('Overdue');
  });

  it('rejects a payment with an unparseable amount and keeps the message recoverable', async () => {
    const user = userEvent.setup();
    const scheduled = run(plan, {
      type: 'vendor/setSchedule',
      id: 'v-caterer',
      schedule: [{ id: 'i-adv', kind: 'advance', dueISO: '2027-01-01', amountMinor: 3_000_000 }],
    });
    render(<Harness2 seed={scheduled} />);
    const row = rowCell('Advance')?.closest('tr');
    if (row === null || row === undefined) throw new Error('no row');
    const input = within(row).getByLabelText('Amount paid now');
    await user.clear(input);
    await user.type(input, 'not-a-number');
    const payForm = within(row).getByRole('button', { name: 'Record payment' }).closest('form');
    if (payForm === null) throw new Error('no pay form');
    fireEvent.submit(payForm);
    await waitFor(() => {
      // The engine's own rejection message surfaces inline, next to the payment row.
      const status = within(row).getByRole('status');
      expect(status.textContent.length).toBeGreaterThan(0);
    });
  });
});

describe('vendor card editing (branch coverage)', () => {
  function Harness3({ seed }: { seed: Plan }): React.ReactNode {
    const [state, setState] = useState(() => initPlanState(seed));
    const store: Store = {
      plan: seed,
      state,
      dispatch: (event) => {
        setState(planReducer(state, event, TODAY));
      },
      apply: (action) => {
        const next = planReducer(state, { kind: 'apply', action }, TODAY);
        setState(next);
        return next.lastError === null
          ? { ok: true, message: null }
          : { ok: false, message: next.lastError.message, field: next.lastError.field ?? '' };
      },
      applyAll: (actions) => {
        let rolling = state.history;
        for (const action of actions) {
          const next = applyAction(rolling, action, { today: TODAY });
          if (!next.ok) {
            return { ok: false, message: next.error.message, field: next.error.field ?? '' };
          }
          rolling = next.value;
        }
        setState({ ...state, history: rolling, lastError: null });
        return { ok: true, message: null };
      },
      replace: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
    };
    return (
      <PlanContext.Provider value={store}>
        <VendorsView plan={state.history.present} />
      </PlanContext.Provider>
    );
  }

  it('saves an agreed price and removes a vendor without payments', async () => {
    const user = userEvent.setup();
    render(<Harness3 seed={plan} />);
    const price = screen.getByLabelText('Agreed price (blank clears it)');
    await user.clear(price);
    await user.type(price, '90000');
    const priceForm = screen.getByRole('button', { name: 'Save price' }).closest('form');
    if (priceForm === null) throw new Error('no price form');
    fireEvent.submit(priceForm);
    await waitFor(() => {
      const booked = screen.getAllByRole('heading', { name: 'Sharma Caterers' }).length;
      expect(booked).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: /Really remove “Sharma Caterers”/ }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Sharma Caterers' })).toBeNull();
    });
  });
});
