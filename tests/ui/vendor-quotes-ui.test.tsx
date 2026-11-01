/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer, type PlanState } from '../../src/state/planState';
import { applyAction } from '../../src/engine/history';
import { makePlan, TODAY } from '../helpers';
import { useState } from 'react';
import { VendorsView } from '../../src/ui/views/vendors';
import { loadQuotes } from '../../src/state/quotes';
import type { Plan } from '../../src/engine/types';

/**
 * The full quotation workflow at component level: read a pasted quote, save it, compare it,
 * accept it — and see the vendor booked in the plan state (what a reload would show).
 */

const plan: Plan = makePlan();

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

describe('quotation workflow in the UI (P2)', () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('reads, saves, compares and accepts a quotation', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          vendorName: 'Sharma Caterers',
          category: 'catering',
          totalPriceMinor: 8_000_000,
          pricePerPlateMinor: null,
          guestMinimum: 100,
          overtimeFeePerHourMinor: null,
          taxIncluded: true,
          advancePercent: 30,
          cancellationPolicy: null,
          inclusions: ['Welcome drinks'],
          exclusions: [],
          source: 'built-in',
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness seed={plan} />);

    // 1. Read a pasted quote.
    await user.type(screen.getByLabelText('Quote text'), 'Catering quote for the wedding...');
    await user.click(screen.getByRole('button', { name: 'Read the quote' }));
    await waitFor(() => {
      expect(screen.getAllByText('Sharma Caterers').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('No cancellation policy stated.')).toBeInTheDocument();

    // 2. Save it for comparison.
    await user.click(screen.getByRole('button', { name: 'Save quotation' }));
    expect(screen.getByText(/Quotation saved/)).toBeInTheDocument();
    expect(loadQuotes(plan.id)).toHaveLength(1);

    // 3. Compare: the card shows the effective price and the honest gaps.
    const compare = screen.getByLabelText('Quotation from Sharma Caterers');
    expect(within(compare).getByText(/Effective for 120 guests/)).toBeInTheDocument();
    expect(
      within(compare).getAllByText(
        (_, element) => element?.tagName === 'P' && element.textContent.includes('Missing:'),
      ).length,
    ).toBeGreaterThan(0);

    // 4. Accept: the vendor becomes booked at the effective price through the engine.
    await user.click(within(compare).getByRole('button', { name: 'Accept this quotation' }));
    await waitFor(() => {
      // The real acceptance check: the vendor card appears in "Your vendors" from plan state.
      expect(
        screen.getAllByRole('heading', { level: 3, name: 'Sharma Caterers' }).length,
      ).toBeGreaterThan(0);
    });
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent.includes('Undo takes it back') ?? false,
      ).length,
    ).toBeGreaterThan(0);

    // 5. The accepted vendor is visible in "Your vendors" and the plan state carries it.
    const vendorHeading = screen.getAllByRole('heading', { name: 'Sharma Caterers' });
    expect(vendorHeading.length).toBeGreaterThan(0);
  });

  it('removes a saved quotation from the comparison', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          vendorName: 'Gupta Decor',
          category: 'decor',
          totalPriceMinor: 1_000_000,
          pricePerPlateMinor: null,
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
    render(<Harness seed={plan} />);
    await user.type(screen.getByLabelText('Quote text'), 'Decor quote...');
    await user.click(screen.getByRole('button', { name: 'Read the quote' }));
    await waitFor(() => {
      expect(screen.getAllByText('Gupta Decor').length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole('button', { name: 'Save quotation' }));
    const compare = screen.getByLabelText('Quotation from Gupta Decor');
    await user.click(within(compare).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(loadQuotes(plan.id)).toHaveLength(0);
    });
    expect(screen.getByText(/No quotations saved yet/)).toBeInTheDocument();
  });
});

describe('quotation compare extras', () => {
  const localFetch = vi.fn();
  it('filters the comparison by category and shows the empty state', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const fetchMock = localFetch;
    fetchMock
      .mockReset()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            vendorName: 'Sharma Caterers',
            category: 'catering',
            totalPriceMinor: 8_000_000,
            pricePerPlateMinor: null,
            guestMinimum: null,
            overtimeFeePerHourMinor: null,
            taxIncluded: true,
            advancePercent: 30,
            cancellationPolicy: null,
            inclusions: [],
            exclusions: [],
            source: 'built-in',
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            vendorName: 'Gupta Decor',
            category: 'decor',
            totalPriceMinor: 1_000_000,
            pricePerPlateMinor: null,
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
    render(<Harness seed={plan} />);
    for (const [quoteText, vendor] of [
      ['catering quote text', 'Sharma Caterers'],
      ['decor quote text', 'Gupta Decor'],
    ] as const) {
      const box = screen.getByLabelText('Quote text');
      await user.clear(box);
      await user.type(box, quoteText);
      await user.click(screen.getByRole('button', { name: 'Read the quote' }));
      await waitFor(() => {
        expect(screen.getAllByText(vendor).length).toBeGreaterThan(0);
      });
      await user.click(screen.getByRole('button', { name: 'Save quotation' }));
      await waitFor(() => {
        expect(screen.getByText(/Quotation saved/)).toBeInTheDocument();
      });
    }
    const compareSelect = document.getElementById('compare-category');
    if (compareSelect === null) throw new Error('no compare select');
    await user.selectOptions(compareSelect, 'All categories');
    expect(screen.getByLabelText('Quotation from Gupta Decor')).toBeInTheDocument();
    await user.selectOptions(compareSelect, 'Photography');
    expect(screen.getByText(/No quotations saved for this category yet/)).toBeInTheDocument();
  });
});
