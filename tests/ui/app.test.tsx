/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from '../../src/ui/App';

// jsdom does not perform implicit form submission on button click, so tests submit forms
// directly; real browsers submit on click (verified in the Playwright suite).

function submitForm(label: string): void {
  const button = screen.getByRole('button', { name: label });
  const form = button.closest('form');
  if (form === null) throw new Error(`no form for ${label}`);
  fireEvent.submit(form);
}

describe('Utsav app shell (jsdom)', () => {
  it('walks the main journey: create event, see budget, log expense', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Setup view is shown first; tabs other than Event are disabled without a plan.
    expect(screen.getByRole('heading', { name: 'Plan your utsav' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('Event name'), 'Asha and Dev wedding');
    const date = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    await user.type(screen.getByLabelText('Event date'), date);
    await user.type(screen.getByLabelText('Expected guests'), '120');
    await user.type(screen.getByLabelText('Total budget in major units (e.g. 800000)'), '800000');
    submitForm('Create the plan');

    // The plan is created, persisted, and the budget view becomes the default.
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Budget' }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText(/[$₹]|INR/).length).toBeGreaterThan(0);
    expect(localStorage.getItem('utsav.plans.v1')).not.toBeNull();

    // Log an expense through the form.
    await user.type(screen.getByLabelText('Amount spent'), '50000');
    await user.type(screen.getByLabelText('Date'), new Date().toISOString().slice(0, 10));
    await user.type(screen.getByLabelText('Note (optional)'), 'venue advance');
    submitForm('Add expense');
    await waitFor(() => {
      expect(screen.getByText('Expense recorded.')).toBeInTheDocument();
    });
    expect(screen.getByText('venue advance')).toBeInTheDocument();
  });

  it('setup view has no axe accessibility violations', async () => {
    render(<App />);
    const results = await axe(document.body);
    expect(results.violations).toHaveLength(0);
  });

  it('shows an engine error message when the form is invalid', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Event name'), 'Test');
    await user.type(screen.getByLabelText('Event date'), '2027-06-01');
    await user.type(screen.getByLabelText('Expected guests'), '0');
    await user.type(screen.getByLabelText('Total budget in major units (e.g. 800000)'), '800000');
    submitForm('Create the plan');
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert').textContent).toContain('Guests');
  });
});
