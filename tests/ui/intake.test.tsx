/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/ui/App';
import { loadSavedPlan } from '../../src/state/persistence';

function submitForm(label: string): void {
  const button = screen.getByRole('button', { name: label });
  const form = button.closest('form');
  if (form === null) throw new Error(`no form for ${label}`);
  fireEvent.submit(form);
}

/**
 * CRITICAL DEFECT 4 regression: the parser detected an occasion but never applied it to the
 * form. Now the occasion select must follow the description, alongside the other fields.
 * Also pins the money contract in the UI: the API answers in true minor units and the form
 * shows major units using the currency's exponent (not a hardcoded /100).
 */
describe('intake prefill applies every detected field', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, _init?: unknown): Promise<Response> => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: 'Aarav turns five',
              occasion: 'birthday',
              dateISO: null,
              guests: 40,
              budgetMinor: 5_000_000,
              notes: null,
              source: 'built-in',
            }),
            { status: 200 },
          ),
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fills the occasion, guests and currency-correct budget from the description', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByLabelText(/For example: "Shaadi in Pune/),
      "Plan a child's birthday with 40 guests, 5 lakh budget",
    );
    await user.click(screen.getByRole('button', { name: 'Fill form from description' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Occasion')).toHaveValue('birthday');
    });
    expect(screen.getByLabelText('Expected guests')).toHaveValue(40);
    // 5,000,000 minor units / 10^2 = 50000 major rupees — never 5,000,000 nor 50,000,000.
    expect(screen.getByLabelText(/Total budget in/)).toHaveValue('50000');
    expect(screen.getByText(/Filled birthday/)).toBeInTheDocument();
  });

  it('clears the budget when the currency changes and says amounts are never converted', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Event name'), 'Aarav turns five');
    await user.type(
      screen.getByLabelText('Event date'),
      new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
    );
    await user.type(screen.getByLabelText('Expected guests'), '40');
    await user.type(screen.getByLabelText(/Total budget in/), '500000');
    await user.selectOptions(screen.getByLabelText('Currency'), 'JPY');
    expect(screen.getByLabelText(/Total budget in/)).toHaveValue('');
    expect(screen.getByLabelText(/Total budget in/)).toBeRequired();
    expect(screen.getByText(/Enter your budget in JPY/)).toBeInTheDocument();
    // The label itself follows the currency (JPY has zero decimals).
    expect(screen.getByLabelText('Total budget in JPY (e.g. 800000)')).toBeInTheDocument();
  });

  it('shows an existing plan back in major units and rejects a locked currency change', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText('Event name'), 'Aarav turns five');
    await user.type(
      screen.getByLabelText('Event date'),
      new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
    );
    await user.type(screen.getByLabelText('Expected guests'), '40');
    await user.type(screen.getByLabelText(/Total budget in/), '500000');
    submitForm('Create the plan');
    await waitFor(() => {
      expect(loadSavedPlan()).not.toBeNull();
    });
    // Record a payment so financial records exist.
    await user.type(screen.getByLabelText('Amount spent'), '1000');
    await user.type(screen.getByLabelText('Date'), new Date().toISOString().slice(0, 10));
    submitForm('Add expense');

    // Back to Event: the budget shows 500000 major units (exponent-correct, not 5000000000).
    await user.click(screen.getByRole('tab', { name: 'Event' }));
    expect(screen.getByLabelText(/Total budget in/)).toHaveValue('500000');
    await user.selectOptions(screen.getByLabelText('Currency'), 'EUR');
    submitForm('Save changes');
    expect(await screen.findByText(/currency is locked/)).toBeInTheDocument();
  });
});

describe('intake prefill with sparse AI replies', () => {
  it('fills only what the reply states and leaves the rest untouched', async () => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, _init?: unknown): Promise<Response> => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: null,
              occasion: null,
              dateISO: null,
              guests: 40,
              budgetMinor: null,
              notes: null,
              source: 'built-in',
            }),
            { status: 200 },
          ),
        );
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByLabelText(/For example: "Shaadi in Pune/),
      'some party for 40 guests',
    );
    await user.click(screen.getByRole('button', { name: 'Fill form from description' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Expected guests')).toHaveValue(40);
    });
    // Nothing else was invented: occasion keeps its default, budget stays empty.
    expect(screen.getByLabelText('Occasion')).toHaveValue('wedding');
    expect(screen.getByLabelText(/Total budget in/)).toHaveValue('');
    expect(screen.getByText(/Filled 40 guests/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('intake prefill guards', () => {
  it('ignores an occasion value outside the supported set instead of applying it', async () => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, _init?: unknown): Promise<Response> => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: null,
              occasion: 'anniversary',
              dateISO: null,
              guests: null,
              budgetMinor: null,
              notes: null,
              source: 'built-in',
            }),
            { status: 200 },
          ),
        );
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByLabelText(/For example: "Shaadi in Pune/),
      'anniversary party somehow',
    );
    await user.click(screen.getByRole('button', { name: 'Fill form from description' }));
    await waitFor(() => {
      expect(screen.getByText(/answered by: built-in/)).toBeInTheDocument();
    });
    // The invalid occasion never reached the select.
    expect(screen.getByLabelText('Occasion')).toHaveValue('wedding');
    vi.unstubAllGlobals();
  });
});
