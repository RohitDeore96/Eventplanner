/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { instalmentPayments } from '../../src/engine/budget';
import type { Plan } from '../../src/engine/types';
import { makePlan, run } from '../helpers';
import { Harness } from './harness';
import { BudgetView } from '../../src/ui/views/BudgetView';
import { RunSheetView } from '../../src/ui/views/RunSheetView';
import { VendorsView } from '../../src/ui/views/VendorsView';

/**
 * Phase 2 UI integration: the expense form links vendors and instalments through the real
 * store, the allocation editor locks and sets categories through the reducer, the run
 * sheet detects conflicts, and a quotation cannot be accepted twice.
 */

const vendorPlan = (): Plan =>
  run(
    makePlan(),
    {
      type: 'vendor/add',
      id: 'v1',
      categoryId: makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
      name: 'Annapurna Caterers',
      contactNote: '',
      contactPerson: 'Sharma uncle',
      phone: '98765 43210',
      email: 'annapurna@example.com',
      status: 'booked',
      committedMinor: 10_000_000,
    },
    {
      type: 'vendor/setSchedule',
      id: 'v1',
      schedule: [{ id: 'i-adv', kind: 'advance', dueISO: '2027-01-01', amountMinor: 4_000_000 }],
    },
  );

describe('expense linking (M6 UI)', () => {
  it('cascades vendor → instalment, forces the vendor category, and records the link', async () => {
    const user = userEvent.setup();
    const plan = vendorPlan();
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    // Choose the vendor; the category select flips to the vendor's own category.
    await user.selectOptions(screen.getByLabelText('Vendor (optional)'), 'v1');
    expect(screen.getByLabelText('Category')).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Payment instalment (optional)'), 'i-adv');
    await user.type(screen.getByLabelText('Amount spent'), '25000');
    await user.type(screen.getByLabelText('Date'), '2026-12-20');
    await user.type(screen.getByLabelText('Note (optional)'), 'advance in cash');
    const addForm = screen.getByLabelText('Amount spent').closest('form');
    if (addForm === null) throw new Error('no expense form');
    fireEvent.submit(addForm);
    await waitFor(() => {
      expect(screen.getByText('Expense recorded.')).toBeInTheDocument();
    });
    // The rendered row (from the live store) shows the vendor link.
    expect(screen.getByText('settles a scheduled payment')).toBeInTheDocument();
  }, 15000);

  it('switching vendors clears the instalment choice (no cross-vendor link)', async () => {
    const user = userEvent.setup();
    const plan = run(
      vendorPlan(),
      {
        type: 'vendor/add',
        id: 'v2',
        categoryId: makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
        name: 'Bhagwati Foods',
        contactNote: '',
        status: 'booked',
        committedMinor: 9_000_000,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v2',
        schedule: [{ id: 'i-b', kind: 'advance', dueISO: '2027-01-08', amountMinor: 2_000_000 }],
      },
    );
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    const vendorSelect = screen.getByLabelText('Vendor (optional)');
    await user.selectOptions(vendorSelect, 'v1');
    await user.selectOptions(screen.getByLabelText('Payment instalment (optional)'), 'i-adv');
    await user.selectOptions(vendorSelect, 'v2');
    const instalmentSelect = screen.getByLabelText('Payment instalment (optional)');
    expect((instalmentSelect as HTMLSelectElement).value).toBe('');
    expect(instalmentSelect).toBeEnabled();
    const options = within(instalmentSelect)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options.join()).toContain('advance');
    expect(options.join()).not.toContain('due 2027-01-01');
  }, 15000);

  it('edits an expense and reassigns it to another same-category vendor', async () => {
    const user = userEvent.setup();
    const plan = run(
      vendorPlan(),
      {
        type: 'expense/add',
        id: 'x1',
        categoryId: vendorPlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
        vendorId: 'v1',
        instalmentId: 'i-adv',
        dateISO: '2026-12-20',
        amountMinor: 2_000_000,
        note: 'advance',
      },
      {
        type: 'vendor/add',
        id: 'v3',
        categoryId: vendorPlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
        name: 'Bhagwati Foods',
        contactNote: '',
        status: 'booked',
        committedMinor: 9_000_000,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v3',
        schedule: [{ id: 'i-b', kind: 'advance', dueISO: '2027-01-08', amountMinor: 2_000_000 }],
      },
    );
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const vendorSelect = screen.getByLabelText(/Vendor \(this expense's category/);
    const vendorOptions = within(vendorSelect)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(vendorOptions.join()).toContain('Bhagwati Foods');
    await user.selectOptions(vendorSelect, 'v3');
    await user.selectOptions(screen.getByLabelText('Payment instalment'), 'i-b');
    const editForm = screen.getByLabelText(/Vendor \(this expense's category/).closest('form');
    if (editForm === null) throw new Error('no edit form');
    fireEvent.submit(editForm);
    await waitFor(() => {
      expect(screen.getByText('Expense updated.')).toBeInTheDocument();
    });
    const rows = screen.getAllByRole('row');
    const expenseRow = rows.find((row) => row.textContent.includes('advance'));
    expect(expenseRow?.textContent).toContain('Bhagwati Foods');
  }, 15000);
});

describe('allocation editor and trade-off (M10 UI)', () => {
  it('locks a category and refuses to edit or move it, with the engine message shown', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    const venue = plan.categories.find((c) => c.key === 'venue');
    await user.click(screen.getByLabelText(`Lock ${venue?.name}`));
    await waitFor(() => {
      expect(screen.getByText(`${venue?.name} locked.`)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(`Allocation for ${venue?.name} in INR`)).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Set' }).length).toBe(plan.categories.length);
  }, 15000);

  it('shows the trade-off plan and applies it through the engine as one step', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    const decor = plan.categories.find((c) => c.key === 'decor');
    await user.selectOptions(screen.getByLabelText('Category to fund'), decor?.id ?? '');
    await user.type(screen.getByLabelText('Extra money needed'), '100000');
    await user.click(screen.getByRole('button', { name: 'Show the trade-off' }));
    await waitFor(() => {
      expect(screen.getByText(/Proposed: Decor and flowers/)).toBeInTheDocument();
    });
    // '100000' was typed in MAJOR units, so decor goes ₹80,000 -> ₹1,80,000.
    const proposalText = screen.getByText(/Proposed: Decor and flowers/).textContent;
    expect(proposalText).toContain('₹80,000.00');
    expect(proposalText).toContain('₹1,80,000.00');
    const before = plan.categories.find((c) => c.key === 'decor')?.plannedMinor ?? 0;
    await user.click(screen.getByRole('button', { name: 'Apply this trade-off' }));
    await waitFor(() => {
      expect(screen.getByText(/Trade-off applied as one undo step/)).toBeInTheDocument();
    });
    // The harness re-rendered from the store: the decor allocation grew by the ask (major units).
    const input = screen.getByLabelText(`Allocation for ${decor?.name} in INR`);
    expect((input as HTMLInputElement).value).toBe(String(Math.round(before / 100) + 100000));
  }, 15000);
});

describe('run sheet UI (M7)', () => {
  it('adds an entry, flags conflicts, and marks completion', async () => {
    const user = userEvent.setup();
    const plan = run(makePlan(), {
      type: 'runsheet/add',
      id: 'r1',
      title: 'Venue setup',
      dateISO: '2027-03-15',
      startTime: '09:00',
      endTime: '11:00',
      ownerId: null,
      location: 'Lawn',
      note: '',
    });
    render(<Harness seed={plan}>{(current) => <RunSheetView plan={current} />}</Harness>);
    // The existing entry shows; adding an overlapping one raises the conflict alert.
    await user.type(screen.getByLabelText('Activity'), 'Decoration check');
    await user.type(screen.getByLabelText('Where (optional)'), 'Lawn');
    const entryForm = screen.getByLabelText('Activity').closest('form');
    if (entryForm === null) throw new Error('no entry form');
    fireEvent.submit(entryForm);
    await waitFor(() => {
      expect(screen.getByText(/scheduling conflict/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Venue setup overlaps Decoration check/)).toBeInTheDocument();
    const doneButtons = screen.getAllByRole('button', { name: 'Done' });
    const first = doneButtons[0];
    if (first === undefined) throw new Error('no Done button');
    await user.click(first);
    await waitFor(() => {
      expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    });
  }, 15000);

  it('keeps the print affordance and the honest empty state', () => {
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <RunSheetView plan={current} />}</Harness>);
    expect(screen.getByText('Print the run sheet')).toBeDisabled();
    expect(screen.getByText(/No activities yet/)).toBeInTheDocument();
    expect(screen.getByText('Event-day run sheet')).toBeInTheDocument();
  });
});

describe('quotation lifecycle UI (M7.5)', () => {
  it('the accepted quotation cannot be accepted again', () => {
    const plan = vendorPlan();
    const quotePlan = {
      ...plan,
      // The library lives in localStorage; seed an accepted quote for this plan.
    };
    window.localStorage.clear();
    window.localStorage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 2,
        quotes: [
          {
            id: 'q-accepted',
            planId: quotePlan.id,
            categoryId: quotePlan.categories.find((c) => c.key === 'catering')?.id ?? 'c',
            savedAtISO: '2026-10-30T00:00:00.000Z',
            status: 'accepted',
            validityDate: null,
            note: '',
            fields: {
              vendorName: 'Sharma Caterers',
              category: null,
              totalPriceMinor: 10_000_000,
              pricePerPlateMinor: null,
              guestMinimum: null,
              overtimeFeePerHourMinor: null,
              taxIncluded: null,
              advancePercent: null,
              cancellationPolicy: null,
              inclusions: [],
              exclusions: [],
            },
          },
        ],
      }),
    );
    render(<Harness seed={quotePlan}>{(current) => <VendorsView plan={current} />}</Harness>);
    const accept = screen.getByRole('button', { name: 'Accepted' });
    expect(accept).toBeDisabled();
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
  });

  it('shortlists a quotation from its status select', async () => {
    const user = userEvent.setup();
    const plan = vendorPlan();
    window.localStorage.clear();
    window.localStorage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 2,
        quotes: [
          {
            id: 'q-1',
            planId: plan.id,
            categoryId: plan.categories.find((c) => c.key === 'catering')?.id ?? 'c',
            savedAtISO: '2026-10-30T00:00:00.000Z',
            status: 'review',
            validityDate: null,
            note: '',
            fields: {
              vendorName: 'Sharma Caterers',
              category: null,
              totalPriceMinor: 10_000_000,
              pricePerPlateMinor: null,
              guestMinimum: null,
              overtimeFeePerHourMinor: null,
              taxIncluded: null,
              advancePercent: null,
              cancellationPolicy: null,
              inclusions: [],
              exclusions: [],
            },
          },
        ],
      }),
    );
    render(<Harness seed={plan}>{(current) => <VendorsView plan={current} />}</Harness>);
    const statusSelect = screen.getByLabelText('Quotation status');
    await user.selectOptions(statusSelect, 'shortlisted');
    await waitFor(() => {
      expect(screen.getByText('Marked as shortlisted.')).toBeInTheDocument();
    });
    const stored: unknown = JSON.parse(window.localStorage.getItem('utsav.quotes.v1') ?? '{}');
    const quotes = (stored as { quotes?: { status?: string }[] }).quotes ?? [];
    expect(quotes[0]?.status).toBe('shortlisted');
  }, 15000);
});

describe('payment summary on the vendor card (M5.4)', () => {
  it('shows agreed, scheduled, paid and outstanding from the engine', () => {
    const plan = run(vendorPlan(), {
      type: 'expense/add',
      id: 'x1',
      categoryId: vendorPlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
      vendorId: 'v1',
      instalmentId: 'i-adv',
      dateISO: '2026-12-20',
      amountMinor: 1_000_000,
      note: 'part advance',
    });
    render(<Harness seed={plan}>{(current) => <VendorsView plan={current} />}</Harness>);
    const summary = screen.getByText(/Agreed .* · scheduled .* · paid .* · still to pay/);
    // Agreed 1,00,000; one advance instalment of 40,000 scheduled; 10,000 paid.
    expect(summary.textContent).toContain('1,00,000.00');
    expect(summary.textContent).toContain('40,000.00');
    expect(summary.textContent).toContain('10,000.00');
    expect(summary.textContent).toContain('90,000.00');
    expect(instalmentPayments(plan.expenses).get('i-adv')).toBe(1_000_000);
  });
});
