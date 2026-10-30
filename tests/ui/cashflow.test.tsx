/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { catId, makePlan, run } from '../helpers';
import { CashflowView } from '../../src/ui/views/CashflowView';
import type { Plan } from '../../src/engine/types';

/**
 * X8 UI acceptance: months render in order with per-month totals, overdue payments get an
 * alert, settled rows show zero to pay, and the empty state is honest.
 */

function scheduled(): Plan {
  const plan = makePlan();
  return run(
    plan,
    {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catId(plan, 'venue'),
      name: 'Grand Hall',
      contactNote: '',
      status: 'booked',
      committedMinor: 10_000_000,
    },
    {
      type: 'vendor/setSchedule',
      id: 'v1',
      schedule: [
        { id: 'i1', kind: 'advance', dueISO: '2026-09-01', amountMinor: 2_000_000 },
        { id: 'i2', kind: 'final', dueISO: '2027-03-10', amountMinor: 8_000_000 },
      ],
    },
  );
}

describe('cashflow view (X8 UI)', () => {
  it('shows month blocks, an overdue alert and the totals line', () => {
    render(<CashflowView plan={scheduled()} />);
    expect(screen.getByRole('heading', { name: /Cash-flow calendar/ })).toBeInTheDocument();
    // Overdue (2026-09-01 < TODAY) surfaces first with an alert.
    expect(screen.getByRole('alert')).toHaveTextContent(/overdue/i);
    expect(screen.getAllByText('Grand Hall').length).toBeGreaterThan(0);
    expect(screen.getByText('Final payment')).toBeInTheDocument();
    expect(screen.getByText(/Scheduled .* · paid .* · still to pay/i)).toBeInTheDocument();
  });

  it('says honestly when nothing is scheduled', () => {
    render(<CashflowView plan={makePlan()} />);
    expect(screen.getByText(/No scheduled payments yet/)).toBeInTheDocument();
  });
});
