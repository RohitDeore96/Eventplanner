/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../../src/engine/types';
import { BudgetView } from '../../src/ui/views/budget';
import { makePlan } from '../helpers';
import { Harness } from './harness';

/**
 * The allocation editor must take each currency's minor-unit exponent from the engine's
 * single currency table (`currencyExponent()`): JPY with 0 decimals, INR with 2, KWD with
 * 3 — the three decimal systems the app offers — and must keep the displayed major units
 * and the stored minor units consistent when an allocation is set.
 */

const CURRENCY_CASES = [
  { currency: 'JPY', decimals: 0 },
  { currency: 'INR', decimals: 2 },
  { currency: 'KWD', decimals: 3 },
] as const;

describe('allocation editor across currency decimal systems', () => {
  it.each(CURRENCY_CASES)(
    'shows $currency allocations in major units with $decimals decimal places',
    ({ currency, decimals }) => {
      const plan = makePlan({ currency, budgetMinor: 800_000 });
      render(<Harness seed={plan}>{(current) => <BudgetView plan={current} />}</Harness>);
      const venue = plan.categories.find((c) => c.key === 'venue');
      if (venue === undefined) throw new Error('no venue category');
      const input = screen.getByLabelText(`Allocation for ${venue.name} in ${currency}`);
      expect(input).toHaveValue(String(Math.round(venue.plannedMinor / 10 ** decimals)));
    },
  );

  it('stores a KWD allocation exactly as typed in major units and shows it back', async () => {
    const user = userEvent.setup();
    const latest: { plan: Plan | null } = { plan: null };
    const plan = makePlan({ currency: 'KWD', budgetMinor: 800_000 });
    render(
      <Harness seed={plan}>
        {(current) => {
          latest.plan = current;
          return <BudgetView plan={current} />;
        }}
      </Harness>,
    );
    const venue = plan.categories.find((c) => c.key === 'venue');
    if (venue === undefined) throw new Error('no venue category');
    const input = screen.getByLabelText(`Allocation for ${venue.name} in KWD`);
    await user.clear(input);
    await user.type(input, '500');
    const row = input.closest('tr');
    if (row === null) throw new Error('no allocation row');
    await user.click(within(row).getByRole('button', { name: 'Set' }));

    // 500 KWD is stored as exactly 500,000 fils (3 minor-unit decimals), never 50,000.
    expect(latest.plan?.categories.find((c) => c.id === venue.id)?.plannedMinor).toBe(500_000);
    // The draft is cleared on success, so the field re-derives from the stored minor units.
    expect(screen.getByLabelText(`Allocation for ${venue.name} in KWD`)).toHaveValue('500');
  });
});
