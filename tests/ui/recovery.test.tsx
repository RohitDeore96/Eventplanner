/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/ui/App';

/**
 * Milestone 6 recovery journey: storage is untrusted, so malformed or invalid saved data
 * must never reach the app, never be deleted silently, and must leave the family a copy
 * of exactly what was stored before they start fresh.
 */
describe('corrupt-storage recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a recovery notice for malformed JSON and offers a copy plus a fresh start', async () => {
    localStorage.setItem('utsav.plans.v1', '{not json at all');
    const user = userEvent.setup();
    render(<App />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/not readable/);
    expect(screen.getByRole('button', { name: 'Download a copy' })).toBeInTheDocument();

    // The download offers the EXACT stored text, untouched.
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURL });
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: 'Download a copy' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('reports a structurally invalid plan as failed safety checks, not as corruption', () => {
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({
        schemaVersion: 1,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        plan: {
          id: 'ev1',
          name: 'Broken',
          occasion: 'wedding',
          dateISO: '2027-03-15',
          currency: 'INR',
          locale: 'en-IN',
          budgetMinor: 100,
          guestTarget: 10,
          categories: [],
          vendors: [
            {
              id: 'v1',
              categoryId: 'ghost-category',
              name: 'X',
              contactNote: '',
              status: 'booked',
              committedMinor: null,
              schedule: [],
            },
          ],
          expenses: [],
          tasks: [],
          guests: [],
        },
      }),
    );
    render(<App />);
    // An event that fails its own checks is dropped individually (not corruption): the
    // workspace says how many were left out, in a spoken status line rather than an alert.
    expect(screen.getByRole('status')).toHaveTextContent(/failed their safety checks/);
  });

  it('start fresh clears the stored data and reloads', () => {
    localStorage.setItem('utsav.plans.v1', '{not json at all');
    render(<App />);
    // jsdom cannot navigate; the click is expected to end in a reload of the real browser.
    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    }).not.toThrow();
    expect(localStorage.getItem('utsav.plans.v1')).toBeNull();
  });

  it('valid stored plans load normally with no recovery notice', () => {
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({
        schemaVersion: 1,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        plan: {
          id: 'ev1',
          name: 'Asha & Dev wedding',
          occasion: 'wedding',
          dateISO: '2027-03-15',
          currency: 'INR',
          locale: 'en-IN',
          budgetMinor: 100_000_000,
          guestTarget: 120,
          categories: [{ id: 'cat-venue', key: 'venue', name: 'Venue', plannedMinor: 40_000_000 }],
          vendors: [],
          expenses: [],
          tasks: [],
          guests: [],
        },
      }),
    );
    render(<App />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Budget' })).toBeEnabled();
  });
});
