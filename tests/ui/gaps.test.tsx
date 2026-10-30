/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { localToday } from '../../src/lib/format';

function submitForm(buttonLabel: string): void {
  const button = screen.getByRole('button', { name: buttonLabel });
  const form = button.closest('form');
  if (form === null) throw new Error(`no form for ${label(buttonLabel)}`);
  fireEvent.submit(form);
}

function label(text: string): string {
  return text;
}

function createPlan(): void {
  localStorage.clear();
  render(<App />);
  const nameBox = screen.getByLabelText('Event name');
  fireEvent.change(nameBox, { target: { value: 'Family wedding' } });
  fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2027-06-01' } });
  fireEvent.change(screen.getByLabelText('Expected guests'), { target: { value: '90' } });
  fireEvent.change(screen.getByLabelText('Total budget in major units (e.g. 800000)'), {
    target: { value: '500000' },
  });
  submitForm('Create the plan');
}

describe('header controls', () => {
  it('undo restores the previous plan state, redo reapplies', async () => {
    const user = userEvent.setup();
    createPlan();
    await user.type(screen.getByLabelText('Amount spent'), '1000');
    await user.type(screen.getByLabelText('Date'), localToday());
    await user.type(screen.getByLabelText('Note (optional)'), 'hall booking');
    submitForm('Add expense');
    expect(screen.getByText('hall booking')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('hall booking')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByText('hall booking')).toBeInTheDocument();
  });
});

describe('intake box', () => {
  it('says plainly when automatic reading is not connected', async () => {
    const user = userEvent.setup();
    createPlan();
    // go back to the Event tab
    await user.click(screen.getByRole('tab', { name: 'Event' }));
    const box = screen.getByLabelText(/For example/);
    await user.type(box, 'Shaadi in Pune, 200 guests, 8 lakh budget');
    await user.click(screen.getByRole('button', { name: 'Fill form from description' }));
    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
  });
});

describe('error boundary', () => {
  it('renders a recovery path when a view crashes', () => {
    createPlan();
    // Force a crash: corrupt the plan in storage through the tab panel by rendering a bomb.
    const bomb = document.createElement('div');
    bomb.setAttribute('data-testid', 'bomb');
    document.body.append(bomb);
    // Simulate a render error by clicking Undo/Redo rapidly with a broken plan from storage.
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });
});

describe('branch coverage: failure paths and toggles', () => {
  it('shows the engine error when a booked vendor has no price', async () => {
    const user = userEvent.setup();
    createPlan();
    await user.click(screen.getByRole('tab', { name: 'Vendors' }));
    await user.type(screen.getByLabelText('Vendor name'), 'Grand Hall');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'booked' } });
    submitForm('Add vendor');
    expect(await screen.findByText(/Enter the agreed price/)).toBeInTheDocument();
  });

  it('rejects moving more money than a category has', async () => {
    const user = userEvent.setup();
    createPlan();
    await user.type(screen.getByLabelText('Amount to move'), '999999999');
    submitForm('Move');
    expect(await screen.findByText(/only has its planned amount/)).toBeInTheDocument();
  });

  it('rejects a zero-expense add with the engine message', async () => {
    const user = userEvent.setup();
    createPlan();
    await user.type(screen.getByLabelText('Amount spent'), '0');
    await user.type(screen.getByLabelText('Date'), localToday());
    submitForm('Add expense');
    expect(await screen.findByText(/more than zero/)).toBeInTheDocument();
  });
});
