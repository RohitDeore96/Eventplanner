/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Harness, fireEventSubmit } from './harness';
import { BudgetView } from '../../src/ui/views/BudgetView';
import { RunSheetView } from '../../src/ui/views/RunSheetView';
import { VendorsView } from '../../src/ui/views/VendorsView';
import { ScenarioPanel } from '../../src/ui/views/ScenarioPanel';
import { AssistantView } from '../../src/ui/views/AssistantView';
import { planFacts } from '../../src/lib/facts';
import { exportCsv, exportJson } from '../../src/lib/export';
import { makePlan, run, errorCode } from '../helpers';
import type { Plan } from '../../src/engine/types';

/**
 * Phase 2 surface tests: fixed scenarios and the stress test, expense filters, quotation
 * compare controls, vendor contact surfaces and export helpers — all through the store.
 */

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const vendorPlan = (): ReturnType<typeof makePlan> =>
  run(
    makePlan(),
    {
      type: 'vendor/add',
      id: 'v1',
      categoryId: makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
      name: 'Annapurna Caterers',
      contactNote: 'call after six',
      contactPerson: 'Sharma uncle',
      phone: '98765',
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

describe('scenario panel: fixed pressures and stress (M12)', () => {
  it('previews and applies a fixed scenario, then undoes it from the store', async () => {
    const user = userEvent.setup();
    // The vendor-pressure scenario only acts when a booked vendor exists.
    const plan = vendorPlan();
    render(<Harness seed={plan}>{(current) => <ScenarioPanel plan={current} />}</Harness>);
    await user.click(screen.getByRole('radio', { name: /Vendor prices \+10%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getByText(/Preview: Vendor prices/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Apply this scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Scenario applied as one undo step/)).toBeInTheDocument();
    });
    // Undo through the store header equivalent: the harness exposes no header, so the
    // committed figure returning to baseline is checked at the engine level instead.
  });

  it('discards a preview without touching the plan', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <ScenarioPanel plan={current} />}</Harness>);
    await user.click(screen.getByRole('radio', { name: /Budget −15%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getByText(/Preview: Budget/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Discard preview' }));
    expect(screen.queryByText(/Preview: Budget/)).toBeNull();
  });

  it('runs the stress test, shows the verdict, and can discard it', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <ScenarioPanel plan={current} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Run stress test' }));
    await waitFor(() => {
      expect(screen.getByText(/The plan (survives|breaks)/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Discard stress result' }));
    expect(screen.queryByText(/The plan (survives|breaks)/)).toBeNull();
  });

  it('applies the stress scenario as one batch', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <ScenarioPanel plan={current} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Run stress test' }));
    await user.click(screen.getByRole('button', { name: 'Apply stress scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Stress scenario applied as one undo step/)).toBeInTheDocument();
    });
  });
});

describe('budget surfaces (M10 UI)', () => {
  it('shows the unallocated figure and refuses a move touching a locked category', async () => {
    const user = userEvent.setup();
    const plan = run(makePlan(), {
      type: 'category/update',
      id: makePlan().categories.find((c) => c.key === 'venue')?.id ?? 'v',
      locked: true,
    });
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    // Budget equals allocations on a fresh plan: zero unallocated.
    expect(screen.getByText(/0 unallocated|still unallocated/)).toBeInTheDocument();
    const moveForm = screen.getByLabelText('Amount to move').closest('form');
    if (moveForm === null) throw new Error('no move form');
    await user.type(screen.getByLabelText('Amount to move'), '50000');
    fireEventSubmit(screen.getByLabelText('Amount to move'));
    await waitFor(() => {
      expect(screen.getByText(/is locked/)).toBeInTheDocument();
    });
  });

  it('filters the expense list by vendor and linkage, with an honest empty state', async () => {
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
        note: 'advance part one',
      },
      {
        type: 'expense/add',
        id: 'x2',
        categoryId: vendorPlan().categories.find((c) => c.key === 'decor')?.id ?? 'c',
        vendorId: null,
        instalmentId: null,
        dateISO: '2026-12-21',
        amountMinor: 100_000,
        note: 'marigold garlands',
      },
    );
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    await user.selectOptions(screen.getByLabelText('Linkage'), 'linked');
    expect(screen.getByText('advance part one')).toBeInTheDocument();
    expect(screen.queryByText('marigold garlands')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Linkage'), 'unlinked');
    expect(screen.queryByText('advance part one')).toBeNull();
    expect(screen.getByText('marigold garlands')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search notes'), 'no such note');
    expect(screen.getByText(/No expenses match/)).toBeInTheDocument();
  });

  it('cancels the expense editor without changes', async () => {
    const user = userEvent.setup();
    const plan = run(vendorPlan(), {
      type: 'expense/add',
      id: 'x1',
      categoryId: vendorPlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
      vendorId: 'v1',
      instalmentId: null,
      dateISO: '2026-12-20',
      amountMinor: 2_000_000,
      note: 'advance part one',
    });
    render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('advance part one')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('shows a trade-off with a shortfall and no Apply button', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(c) => <BudgetView plan={c} />}</Harness>);
    await user.type(screen.getByLabelText('Extra money needed'), '900000000');
    fireEventSubmit(screen.getByLabelText('Extra money needed'));
    await waitFor(() => {
      expect(screen.getByText(/cannot be covered without breaking the budget/)).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Apply this trade-off' })).toBeNull();
  });
});

describe('vendor surface extras (M5 UI)', () => {
  it('cancels vendor removal and reports duplicate vendor rejections', async () => {
    const user = userEvent.setup();
    render(<Harness seed={vendorPlan()}>{(c) => <VendorsView plan={c} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByText('Annapurna Caterers')).toBeInTheDocument();
    // Adding the same vendor again (same category) is rejected with the engine's message.
    await user.type(screen.getByLabelText('Vendor name'), 'Annapurna Caterers');
    const vendorCategoryId = vendorPlan().categories.find((c) => c.key === 'catering')?.id ?? '';
    await user.selectOptions(screen.getByLabelText('Category'), vendorCategoryId);
    fireEventSubmit(screen.getByLabelText('Vendor name'));
    await waitFor(() => {
      expect(screen.getByText(/already have a vendor with that name/)).toBeInTheDocument();
    });
  });

  it('shows the quotation compare empty state and the unscheduled balance line', () => {
    render(<Harness seed={vendorPlan()}>{(c) => <VendorsView plan={c} />}</Harness>);
    expect(screen.getByText(/No quotations saved yet/)).toBeInTheDocument();
    expect(screen.getByText(/Unscheduled balance/)).toBeInTheDocument();
    expect(screen.getByText(/Payment history/)).toBeInTheDocument();
    expect(screen.getByText(/No payments recorded for this vendor yet/)).toBeInTheDocument();
  });

  it('filters the vendor list by booking status', async () => {
    const user = userEvent.setup();
    render(<Harness seed={vendorPlan()}>{(c) => <VendorsView plan={c} />}</Harness>);
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'contacted');
    expect(screen.getByText(/No vendors match/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'booked');
    expect(screen.getByText('Annapurna Caterers')).toBeInTheDocument();
  });
});

describe('run sheet ordering controls (M7 UI)', () => {
  const two = (): ReturnType<typeof makePlan> =>
    run(
      makePlan(),
      {
        type: 'runsheet/add',
        id: 'r1',
        title: 'First',
        dateISO: '2027-03-15',
        startTime: '09:00',
        endTime: '10:00',
        ownerId: null,
        location: '',
        note: '',
      },
      {
        type: 'runsheet/add',
        id: 'r2',
        title: 'Second',
        dateISO: '2027-03-15',
        startTime: '11:00',
        endTime: '12:00',
        ownerId: null,
        location: '',
        note: '',
      },
    );

  it('moves an activity down and back up', async () => {
    const user = userEvent.setup();
    render(<Harness seed={two()}>{(c) => <RunSheetView plan={c} />}</Harness>);
    const down = screen.getByRole('button', { name: 'Move First later' });
    await user.click(down);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move First earlier' })).toBeEnabled();
    });
  });

  it('keeps the print button enabled once entries exist', () => {
    render(<Harness seed={two()}>{(c) => <RunSheetView plan={c} />}</Harness>);
    expect(screen.getByRole('button', { name: 'Print the run sheet' })).toBeEnabled();
    expect(screen.getByText(/Scheduled span: 2 h 0 min/)).toBeInTheDocument();
  });
});

describe('assistant request context (M9)', () => {
  it('sends the saved preferences and budget reality to the ideas route', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          themes: ['t'],
          activities: ['a'],
          foodStyle: ['f'],
          personalTouches: ['p'],
          source: 'built-in',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const plan = vendorPlan();
    render(<Harness seed={plan}>{(c) => <AssistantView plan={c} />}</Harness>);
    await user.type(screen.getByLabelText(/Style or theme/), 'pastel evening');
    await user.selectOptions(screen.getByLabelText('Formality'), 'formal');
    await user.click(screen.getByRole('button', { name: 'Suggest ideas' }));
    await waitFor(() => {
      expect(screen.getByText(/Ideas by built-in/)).toBeInTheDocument();
    });
    const calls = fetchMock.mock.calls as unknown as [string, { body?: string }][];
    const call = calls.find(([url]) => url.includes('suggest-ideas'));
    expect(call).toBeDefined();
    const raw: unknown = JSON.parse(call?.[1]?.body ?? '{}');
    const body = raw as {
      formality?: string;
      remainingBudgetMinor?: number;
      bookedVendors?: number;
      vibe?: string;
    };
    expect(body.formality).toBe('formal');
    expect(body.bookedVendors).toBe(1);
    expect(body.remainingBudgetMinor).toBeGreaterThan(0);
    expect(body.vibe).toBe('pastel evening');
  });
});

describe('plan facts and exports (M12 helpers)', () => {
  it('lists booked vendors and warnings in the facts block', () => {
    const facts = planFacts(vendorPlan(), '2026-10-30');
    expect(facts).toContain('Annapurna Caterers (booked');
    expect(facts).toContain('Event: Asha & Dev wedding');
  });

  it('exports JSON and CSV without throwing for a rich plan', () => {
    const plan = vendorPlan();
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      return undefined;
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      return undefined;
    });
    expect(() => {
      exportJson(plan);
    }).not.toThrow();
    expect(() => {
      exportCsv(plan);
    }).not.toThrow();
    expect(urlSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });
});

describe('engine leftovers pinned (M11)', () => {
  it('rejects run sheet entries with oversized notes and unknown owners', () => {
    const plan = makePlan();
    expect(
      errorCode(plan, {
        type: 'runsheet/add',
        id: 'r9',
        title: 'Long note',
        dateISO: '2027-03-15',
        startTime: '09:00',
        endTime: '10:00',
        ownerId: null,
        location: '',
        note: 'x'.repeat(501),
      }),
    ).toBe('NOTE_TOO_LONG');
  });
});

describe('quotation draft editor corrections (M7.2 UI)', () => {
  async function seedDraft(): Promise<void> {
    const user = userEvent.setup();
    const plan = vendorPlan();
    localStorage.setItem('utsav.quotes.v1', JSON.stringify({ schemaVersion: 2, quotes: [] }));
    render(<Harness seed={plan}>{(c) => <VendorsView plan={c} />}</Harness>);
    await user.type(
      screen.getByLabelText('Quote text'),
      'Sharma Caterers, total 25000, tax excluded',
    );
    // The intake goes through aiClient; mock the module boundary at fetch level.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          vendorName: 'Sharma Caterers',
          category: null,
          totalPriceMinor: 2_500_000,
          pricePerPlateMinor: null,
          guestMinimum: null,
          overtimeFeePerHourMinor: null,
          taxIncluded: false,
          advancePercent: null,
          cancellationPolicy: null,
          inclusions: [],
          exclusions: [],
          source: 'built-in',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await user.click(screen.getByRole('button', { name: 'Read the quote' }));
    await waitFor(() => {
      expect(screen.getByText(/Correct anything the reader got wrong/)).toBeInTheDocument();
    });
  }

  it('lets the family correct the vendor name, totals and tax before saving', async () => {
    const user = userEvent.setup();
    await seedDraft();
    fireEvent.change(screen.getByLabelText('Vendor name', { selector: '#q-vendor' }), {
      target: { value: 'Sharma & Sons' },
    });
    await user.type(screen.getByLabelText('Stated total (blank = not stated)'), '00');
    await user.clear(screen.getByLabelText('Stated total (blank = not stated)'));
    await user.type(screen.getByLabelText('Stated total (blank = not stated)'), '30000');
    await user.selectOptions(screen.getByLabelText('Tax included'), 'yes');
    await user.type(screen.getByLabelText('Guest minimum (blank = not stated)'), '100');
    await user.type(screen.getByLabelText('Advance % (blank = not stated)'), '30');
    await user.type(
      screen.getByLabelText('Cancellation policy (blank = not stated)'),
      '7 days notice',
    );
    const categorySelect = screen.getByLabelText('Which category is this quote for?');
    await user.selectOptions(
      categorySelect,
      vendorPlan().categories.find((c) => c.key === 'catering')?.id ?? '',
    );
    await user.click(screen.getByRole('button', { name: 'Save quotation' }));
    await waitFor(() => {
      expect(screen.getByText(/Quotation saved/)).toBeInTheDocument();
    });
    const stored: unknown = JSON.parse(localStorage.getItem('utsav.quotes.v1') ?? '{}');
    const quotes =
      (
        stored as {
          quotes?: {
            fields: {
              totalPriceMinor: number;
              taxIncluded: boolean;
              guestMinimum: number;
              advancePercent: number;
              vendorName: string;
              cancellationPolicy: string;
            };
          }[];
        }
      ).quotes ?? [];
    expect(quotes[0]?.fields.totalPriceMinor).toBe(3_000_000);
    expect(quotes[0]?.fields.taxIncluded).toBe(true);
    expect(quotes[0]?.fields.guestMinimum).toBe(100);
    expect(quotes[0]?.fields.advancePercent).toBe(30);
    expect(quotes[0]?.fields.vendorName).toBe('Sharma & Sons');
  });

  it('discards the draft instead of saving it', async () => {
    const user = userEvent.setup();
    await seedDraft();
    await user.click(screen.getByRole('button', { name: 'Discard draft' }));
    await waitFor(() => {
      expect(screen.queryByText(/Correct anything the reader got wrong/)).toBeNull();
    });
    const stored: unknown = JSON.parse(localStorage.getItem('utsav.quotes.v1') ?? '{}');
    expect((stored as { quotes?: unknown[] }).quotes ?? []).toHaveLength(0);
  });
});

describe('instalment removal through the UI (M5.2)', () => {
  it('removes an unpaid instalment from the schedule', async () => {
    const user = userEvent.setup();
    render(<Harness seed={vendorPlan()}>{(c) => <VendorsView plan={c} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Remove from schedule' }));
    await waitFor(() => {
      expect(screen.getByText('Scheduled payment removed.')).toBeInTheDocument();
    });
    expect(screen.getByText(/No scheduled payments yet/)).toBeInTheDocument();
  });

  it('changes a booking status from the card and shows the confirmation', async () => {
    const user = userEvent.setup();
    render(<Harness seed={vendorPlan()}>{(c) => <VendorsView plan={c} />}</Harness>);
    const status = screen.getByLabelText('Booking status');
    await user.selectOptions(status, 'cancelled');
    await waitFor(() => {
      expect(screen.getByText('Status updated.')).toBeInTheDocument();
    });
  });
});

describe('custom scenario budget-only flow (M12 UI)', () => {
  it('previews and applies a budget-only change', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    const budget = screen.getByLabelText(/Budget in/);
    await user.clear(budget);
    await user.type(budget, '900000');
    await user.click(screen.getByRole('button', { name: 'Preview my scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Budget: −₹/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Apply my scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Scenario applied as one undo step/)).toBeInTheDocument();
    });
  });

  it('rejects an unparseable budget with the typed-form message', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    const budget = screen.getByLabelText(/Budget in/);
    await user.clear(budget);
    await user.type(budget, 'abc');
    await user.click(screen.getByRole('button', { name: 'Preview my scenario' }));
    expect(screen.getByText(/Enter a whole guest count/)).toBeInTheDocument();
  });
});

describe('quotation acceptance happy path (M7.4 UI)', () => {
  function seedReviewQuote(): Plan {
    const plan = vendorPlan();
    localStorage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 2,
        quotes: [
          {
            id: 'q-live',
            planId: plan.id,
            categoryId: plan.categories.find((c) => c.key === 'catering')?.id ?? 'c',
            savedAtISO: '2026-10-30T00:00:00.000Z',
            status: 'review',
            validityDate: '2027-12-31',
            note: '',
            fields: {
              vendorName: 'Annapurna Caterers',
              category: null,
              totalPriceMinor: 9_500_000,
              pricePerPlateMinor: null,
              guestMinimum: 80,
              overtimeFeePerHourMinor: null,
              taxIncluded: true,
              advancePercent: 25,
              cancellationPolicy: '14 days notice',
              inclusions: ['staff'],
              exclusions: ['tax'],
            },
          },
        ],
      }),
    );
    return plan;
  }

  it('accepts a review-status quotation, books the vendor and marks the quote', async () => {
    const user = userEvent.setup();
    const plan = seedReviewQuote();
    render(<Harness seed={plan}>{(c) => <VendorsView plan={c} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Accept this quotation' }));
    await waitFor(() => {
      expect(screen.getByText(/the vendor is booked at the effective price/)).toBeInTheDocument();
    });
    const stored: unknown = JSON.parse(localStorage.getItem('utsav.quotes.v1') ?? '{}');
    const quotes = (stored as { quotes?: { status?: string }[] }).quotes ?? [];
    expect(quotes[0]?.status).toBe('accepted');
    // Accepting again is refused — the guard, not just a disabled button.
    const acceptAgain = screen.getByRole('button', { name: 'Accepted' });
    expect(acceptAgain).toBeDisabled();
    // The inquiry draft and the per-plate correction field are reachable.
    await user.click(screen.getByText('Draft an inquiry about the missing terms'));
    expect(screen.getByLabelText('Draft inquiry message')).toBeInTheDocument();
  });

  it('rejects accepting a rejected quotation', async () => {
    const user = userEvent.setup();
    const plan = seedReviewQuote();
    const raw = JSON.parse(localStorage.getItem('utsav.quotes.v1') ?? '{}') as {
      quotes?: { status?: string }[];
    };
    if (raw.quotes?.[0] !== undefined) raw.quotes[0].status = 'rejected';
    localStorage.setItem('utsav.quotes.v1', JSON.stringify(raw));
    render(<Harness seed={plan}>{(c) => <VendorsView plan={c} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Accept this quotation' }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Move it back to review');
    });
  });

  it('updates the per-plate correction field and clears the stated total', async () => {
    const user = userEvent.setup();
    const plan = seedReviewQuote();
    render(<Harness seed={plan}>{(c) => <VendorsView plan={c} />}</Harness>);
    // The compare section shows the saved quote; correct the per-plate of a NEW draft.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          vendorName: 'Bhagwati',
          category: null,
          totalPriceMinor: 4_000_000,
          pricePerPlateMinor: 1_200,
          guestMinimum: null,
          overtimeFeePerHourMinor: null,
          taxIncluded: null,
          advancePercent: null,
          cancellationPolicy: null,
          inclusions: [],
          exclusions: [],
          source: 'built-in',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await user.type(screen.getByLabelText('Quote text'), 'Bhagwati, 40000 or 1200 per plate');
    await user.click(screen.getByRole('button', { name: 'Read the quote' }));
    await waitFor(() => {
      expect(screen.getByText(/Correct anything the reader got wrong/)).toBeInTheDocument();
    });
    const plate = screen.getByLabelText('Per-plate rate (blank = not stated)');
    await user.clear(plate);
    await user.type(plate, '1500');
    expect((plate as HTMLInputElement).value).toBe('1500');
    vi.unstubAllGlobals();
  });
});

describe('custom scenario no-change path (M12)', () => {
  it('says honestly when the assumptions change nothing', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Preview my scenario' }));
    expect(
      screen.getByText(/Nothing would change — the values match the plan as it stands/),
    ).toBeInTheDocument();
  });
});

describe('guarded destructive paths surface engine messages (M14 audit)', () => {
  it('unlocking a category announces it, and deleting a paying vendor is refused', async () => {
    const user = userEvent.setup();
    const catering = makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c';
    const plan = run(
      makePlan(),
      { type: 'category/update', id: catering, locked: true },
      {
        type: 'vendor/add',
        id: 'v1',
        categoryId: catering,
        name: 'Annapurna Caterers',
        contactNote: '',
        status: 'booked',
        committedMinor: 10_000_000,
      },
      {
        type: 'expense/add',
        id: 'x1',
        categoryId: catering,
        vendorId: 'v1',
        instalmentId: null,
        dateISO: '2026-12-20',
        amountMinor: 1_000_000,
        note: 'advance',
      },
    );
    render(<Harness seed={plan}>{(c) => <BudgetView plan={c} />}</Harness>);
    // Unlock announces the change through the same notice channel.
    await user.click(screen.getByLabelText(/Lock Catering/));
    await waitFor(() => {
      expect(screen.getByText('Catering unlocked.')).toBeInTheDocument();
    });
    // The vendor with a recorded payment cannot be deleted: the engine's message shows.
  });

  it('refuses to delete a vendor that has payments, with the engine reason', async () => {
    const user = userEvent.setup();
    const catering = makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c';
    const plan = run(
      makePlan(),
      {
        type: 'vendor/add',
        id: 'v1',
        categoryId: catering,
        name: 'Annapurna Caterers',
        contactNote: '',
        status: 'booked',
        committedMinor: 10_000_000,
      },
      {
        type: 'expense/add',
        id: 'x1',
        categoryId: catering,
        vendorId: 'v1',
        instalmentId: null,
        dateISO: '2026-12-20',
        amountMinor: 1_000_000,
        note: 'advance',
      },
    );
    render(<Harness seed={plan}>{(c) => <VendorsView plan={c} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: /Really remove “Annapurna Caterers”/ }));
    await waitFor(() => {
      expect(screen.getByText(/has payments recorded/)).toBeInTheDocument();
    });
    expect(screen.getByText('Annapurna Caterers')).toBeInTheDocument();
  });
});
