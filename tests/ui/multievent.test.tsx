/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { makePlan } from '../helpers';

/**
 * R8 integration: two saved events load together, switching keeps each event's own data,
 * deletion needs the second click and updates the active marker, and creating a new event
 * joins the workspace as active. Storage is checked directly, like a reload would read it.
 */

function seedWorkspace(): void {
  const a = makePlan({ id: 'ev1', name: 'Asha & Dev wedding' });
  const b = makePlan({ id: 'ev2', name: 'Diwali party' });
  localStorage.setItem(
    'utsav.plans.v1',
    JSON.stringify({
      schemaVersion: 2,
      savedAtISO: '2026-10-30T00:00:00.000Z',
      activeId: 'ev1',
      plans: [a, b],
    }),
  );
}

function storedRecord(): { activeId: string | null; plans: { id: string; name: string }[] } {
  const raw = localStorage.getItem('utsav.plans.v1');
  if (raw === null) throw new Error('nothing stored');
  return JSON.parse(raw) as { activeId: string | null; plans: { id: string; name: string }[] };
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (row === null) throw new Error(`row for ${name} missing`);
  return row;
}

afterEach(() => {
  localStorage.clear();
});

describe('multi-event workspace (R8 integration)', () => {
  it('lists saved events, switches the active one, and keeps separate data', async () => {
    seedWorkspace();
    const user = userEvent.setup();
    render(<App />);

    // Both events are on the manager, the seeded active one marked.
    await user.click(screen.getByRole('tab', { name: 'All events' }));
    expect(rowFor('Asha & Dev wedding').textContent).toContain('active');
    expect(rowFor('Diwali party').textContent).not.toContain('active');

    // Switch to the second event; storage moves the active marker...
    await user.click(within(rowFor('Diwali party')).getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(storedRecord().activeId).toBe('ev2');
    });
    // ...and after coming back the badge sits on the right row.
    await user.click(screen.getByRole('tab', { name: 'All events' }));
    expect(rowFor('Diwali party').textContent).toContain('active');
    expect(rowFor('Asha & Dev wedding').textContent).not.toContain('active');
  });

  it('deletes a non-active event after confirmation, keeping the active one', async () => {
    seedWorkspace();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'All events' }));

    await user.click(within(rowFor('Diwali party')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /Really delete “Diwali party”/ }));
    await waitFor(() => {
      expect(storedRecord().plans).toHaveLength(1);
    });
    expect(storedRecord().activeId).toBe('ev1');
    expect(screen.queryByText('Diwali party')).toBeNull();
    expect(screen.getByText('Asha & Dev wedding')).toBeInTheDocument();
  });

  it('creates a new event into the workspace as the active one', async () => {
    seedWorkspace();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'All events' }));
    await user.click(screen.getByRole('button', { name: 'New event' }));

    // The setup form is in create mode.
    await user.type(screen.getByLabelText('Event name'), 'Housewarming');
    await user.type(screen.getByLabelText('Event date'), '2027-06-01');
    await user.type(screen.getByLabelText('Expected guests'), '40');
    await user.type(screen.getByLabelText(/^Total budget in/), '300000');
    await user.click(screen.getByRole('button', { name: 'Create the plan' }));

    await waitFor(() => {
      expect(storedRecord().plans.map((p) => p.name)).toContain('Housewarming');
    });
    const record = storedRecord();
    expect(record.plans).toHaveLength(3);
    expect(record.activeId).not.toBe('ev1');
  });

  it('deleting the active event activates the first survivor', async () => {
    seedWorkspace();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'All events' }));

    await user.click(within(rowFor('Asha & Dev wedding')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /Really delete/ }));
    await waitFor(() => {
      expect(storedRecord().activeId).toBe('ev2');
    });
    expect(storedRecord().plans).toHaveLength(1);
  });
});
