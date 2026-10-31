/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { PlanContext, type Store } from '../../src/state/store';
import { initPlanState, planReducer, type PlanState } from '../../src/state/planState';
import { applyAction } from '../../src/engine/history';
import { catId, makePlan, TODAY } from '../helpers';
import { VendorsView } from '../../src/ui/views/VendorsView';
import { loadQuotes, saveQuote, setQuoteStatus } from '../../src/state/quotes';
import type { QuoteFields } from '../../src/schemas/ai';
import type { Plan } from '../../src/engine/types';

/**
 * Regression tests (targeted bug-fix audit): the acceptance workflow must not book a
 * vendor on the strength of a quotation-status write that never persisted, and must say
 * so honestly. setQuoteStatus() reports false when the library cannot be written (quota
 * exceeded, byte cap, missing record) — a silent false left the vendor booked while the
 * quotation stayed in its previous status, and the "already accepted" double-booking
 * guard never came into effect.
 */

const plan: Plan = makePlan();

function fieldsFor(vendorName: string): QuoteFields {
  return {
    vendorName,
    // A category is required for acceptance: the engine books the vendor into it.
    category: 'catering',
    totalPriceMinor: 2_500_000,
    pricePerPlateMinor: null,
    guestMinimum: null,
    overtimeFeePerHourMinor: null,
    taxIncluded: null,
    advancePercent: null,
    cancellationPolicy: null,
    inclusions: [],
    exclusions: [],
  };
}

function realApplyAll(state: PlanState, setState: (next: PlanState) => void): Store['applyAll'] {
  return (actions) => {
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
  };
}

function Harness({
  seed,
  applyAll,
}: {
  seed: Plan;
  applyAll?: Store['applyAll'];
}): React.ReactNode {
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
    applyAll: applyAll ?? realApplyAll(state, setState),
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

describe('quotation acceptance when the status write fails (regression)', () => {
  // Read through the descriptor, not `Storage.prototype.setItem` directly, so the method
  // reference never detaches from its object.
  const realSetItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')
    ?.value as Storage['setItem'];

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks(); // puts the original setItem back
    window.localStorage.clear();
  });

  it('does not book the vendor when the accepted status cannot be saved, and says so', async () => {
    const saved = saveQuote({
      planId: plan.id,
      categoryId: catId(plan, 'catering'),
      fields: fieldsFor('Sharma Caterers'),
    });
    if (saved === null) throw new Error('fixture failed');
    expect(setQuoteStatus(saved.id, 'shortlisted')).toBe(true);

    const applyAllSpy = vi.fn(realApplyAll(initPlanState(plan), () => undefined));
    render(<Harness seed={plan} applyAll={applyAllSpy} />);
    const compare = screen.getByRole('region', { name: 'Compare saved quotations' });
    const card = within(compare).getByLabelText('Quotation from Sharma Caterers');

    // The quotation library can no longer be written (quota exceeded, byte cap, ...).
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function failingWrite(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'utsav.quotes.v1') {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      realSetItem.call(this, key, value);
    });

    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Accept this quotation' }));

    // The booking never happened: no plan change was even attempted…
    expect(applyAllSpy).not.toHaveBeenCalled();
    // …the quotation keeps its previous status…
    expect(loadQuotes(plan.id)[0]?.status).toBe('shortlisted');
    // …and the notice reports the failure instead of announcing a booking.
    const notice = within(compare).getByRole('status').textContent;
    expect(notice).toMatch(/could not be saved/i);
    expect(notice).toMatch(/not booked/i);
    expect(notice).not.toMatch(/Undo takes it back/);
  });

  it('restores the previous status when the engine refuses the booking afterwards', async () => {
    const saved = saveQuote({
      planId: plan.id,
      categoryId: catId(plan, 'catering'),
      fields: fieldsFor('Sharma Caterers'),
    });
    if (saved === null) throw new Error('fixture failed');
    expect(setQuoteStatus(saved.id, 'shortlisted')).toBe(true);

    const refused: Store['applyAll'] = () => ({
      ok: false,
      message: 'The plan refused the booking for this quotation.',
      field: '',
    });
    render(<Harness seed={plan} applyAll={refused} />);
    const compare = screen.getByRole('region', { name: 'Compare saved quotations' });
    const card = within(compare).getByLabelText('Quotation from Sharma Caterers');

    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Accept this quotation' }));

    // The status write succeeded, then the booking failed: the compensation puts the
    // quote back where it was instead of leaving a booking-less "accepted" badge.
    expect(loadQuotes(plan.id)[0]?.status).toBe('shortlisted');
    const notice = within(compare).getByRole('status').textContent;
    expect(notice).toContain('The plan refused the booking for this quotation.');
    expect(notice).not.toMatch(/Undo takes it back/);
  });
});
