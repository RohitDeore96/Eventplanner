/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { loadSavedPlan } from '../../src/state/persistence';

// jsdom does not perform implicit form submission on button click, so tests submit forms
// directly; real browsers submit on click.

function submitForm(label: string): void {
  const button = screen.getByRole('button', { name: label });
  const form = button.closest('form');
  if (form === null) throw new Error(`no form for ${label}`);
  fireEvent.submit(form);
}

/**
 * CRITICAL DEFECT 2 regression: autosave used to depend on the original `plan` prop, so a
 * plan created in a session that STARTED with empty storage was never saved again after
 * creation. This walks the real lifecycle: start empty, create, change, undo, redo — and
 * checks what a reload would actually restore.
 */
describe('autosave lifecycle (starts with empty storage)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves the created plan and every later change, including undo and redo', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 1. Create a plan from nothing.
    await user.type(screen.getByLabelText('Event name'), 'Asha and Dev wedding');
    const date = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    await user.type(screen.getByLabelText('Event date'), date);
    await user.type(screen.getByLabelText('Expected guests'), '120');
    await user.type(screen.getByLabelText(/Total budget in/), '800000');
    submitForm('Create the plan');
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Budget' }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    const created = loadSavedPlan();
    expect(created).not.toBeNull();
    expect(created?.name).toBe('Asha and Dev wedding');

    // 2. A later modification (an expense) must also reach storage.
    await user.type(screen.getByLabelText('Amount spent'), '50000');
    await user.type(screen.getByLabelText('Date'), new Date().toISOString().slice(0, 10));
    await user.type(screen.getByLabelText('Note (optional)'), 'venue advance');
    submitForm('Add expense');
    await waitFor(() => {
      expect(screen.getByText('Expense recorded.')).toBeInTheDocument();
    });
    expect(loadSavedPlan()?.expenses).toHaveLength(1);

    // 3. Undo must persist too: storage reflects the reverted plan.
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(loadSavedPlan()?.expenses).toHaveLength(0);
    });

    // 4. Redo must persist as well.
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => {
      expect(loadSavedPlan()?.expenses).toHaveLength(1);
    });

    // 5. What a reload would restore matches the visible plan exactly (major units × 100
    // for the default currency — INR or USD, both with two decimals — either way ₹/$8,00,000).
    const restored = loadSavedPlan();
    expect(restored?.budgetMinor).toBe(80_000_000);
    expect(restored?.expenses[0]?.note).toBe('venue advance');
  });
});
